import { sequelize } from '../config/database.js';
import { notFound, staleRecord, validationError } from '../errors/app-error.js';
import { isKnownTimeZone, type WorkingCalendar } from '../lib/business-hours.js';
import { BusinessCalendar, CalendarException } from '../models/index.js';
import * as auditService from './audit.service.js';
import type { Actor, AuditContext } from './ticket.service.js';

/**
 * The business calendar (Phase 6, FR-026, FR-027).
 *
 * ONE ACTIVE CALENDAR for the organisation. Per-department calendars are
 * Phase 12's concern and are not anticipated here.
 *
 * The wire shape is an ARRAY of weekday numbers; storage is a BITMASK. The
 * conversion happens here, at the boundary, so neither the checkbox group that
 * binds to an array nor the arithmetic that wants a mask is compromised.
 */

/** Sunday = 0, matching bit 0 of the stored mask. */
const DAYS_IN_WEEK = 7;

export function maskToDays(mask: number): number[] {
  const days: number[] = [];

  for (let day = 0; day < DAYS_IN_WEEK; day += 1) {
    if ((mask & (1 << day)) !== 0) days.push(day);
  }

  return days;
}

export function daysToMask(days: readonly number[]): number {
  return days.reduce((mask, day) => mask | (1 << day), 0);
}

export interface CalendarView {
  id: number;
  name: string;
  timeZone: string;
  workingDays: number[];
  dayStartMinute: number;
  dayEndMinute: number;
  exceptions: Array<{ id: number; date: string; label: string | null }>;
  version: number;
}

type Loaded = BusinessCalendar & { exceptions?: CalendarException[] };

async function loadActive(): Promise<Loaded> {
  const calendar = (await BusinessCalendar.findOne({
    where: { is_active: true },
    include: [{ model: CalendarException, as: 'exceptions' }],
    order: [['id', 'ASC']],
  })) as Loaded | null;

  if (!calendar) {
    // A seeded installation always has one. Reaching here means the seeder was
    // never run, which is a setup failure rather than a request failure.
    throw notFound();
  }

  return calendar;
}

function toView(calendar: Loaded): CalendarView {
  return {
    id: calendar.id,
    name: calendar.name,
    timeZone: calendar.time_zone,
    workingDays: maskToDays(calendar.working_days),
    dayStartMinute: calendar.day_start_minute,
    dayEndMinute: calendar.day_end_minute,
    exceptions: (calendar.exceptions ?? [])
      .slice()
      .sort((a, b) => a.exception_date.localeCompare(b.exception_date))
      .map((exception) => ({
        id: exception.id,
        date: exception.exception_date,
        label: exception.label,
      })),
    version: calendar.version,
  };
}

export async function get(): Promise<CalendarView> {
  return toView(await loadActive());
}

/**
 * The shape `lib/business-hours.ts` consumes.
 *
 * READ ONCE PER OPERATION, not per ticket: the sweep computes targets for many
 * tickets against one calendar, and re-reading it per row would turn a sweep
 * into a query storm.
 */
export async function workingCalendar(): Promise<WorkingCalendar> {
  const calendar = await loadActive();

  return {
    timeZone: calendar.time_zone,
    workingDays: calendar.working_days,
    dayStartMinute: calendar.day_start_minute,
    dayEndMinute: calendar.day_end_minute,
    exceptions: new Set((calendar.exceptions ?? []).map((exception) => exception.exception_date)),
  };
}

export interface UpdateCalendarInput {
  name?: unknown;
  timeZone?: unknown;
  workingDays?: unknown;
  dayStartMinute?: unknown;
  dayEndMinute?: unknown;
  version: unknown;
}

function validate(
  input: UpdateCalendarInput,
  current: BusinessCalendar,
): {
  name: string;
  timeZone: string;
  mask: number;
  start: number;
  end: number;
} {
  const errors: Array<{ field: string; message: string }> = [];

  const name =
    input.name === undefined ? current.name : String(input.name ?? '').trim() || current.name;

  const timeZone = input.timeZone === undefined ? current.time_zone : String(input.timeZone ?? '');

  // REFUSED HERE, at the boundary, so an unknown zone can never reach a sweep.
  // Intl throws a RangeError for one, and a scheduler tick is the worst place
  // in this system to discover a configuration error.
  if (!isKnownTimeZone(timeZone)) {
    errors.push({ field: 'timeZone', message: 'sla.error.timeZoneUnknown' });
  }

  let mask = current.working_days;

  if (input.workingDays !== undefined) {
    const days = Array.isArray(input.workingDays) ? input.workingDays : [];
    const valid = days.every(
      (day) => Number.isInteger(day) && (day as number) >= 0 && (day as number) < DAYS_IN_WEEK,
    );

    if (!valid) {
      errors.push({ field: 'workingDays', message: 'sla.error.workingDaysInvalid' });
    } else if (days.length === 0) {
      // A calendar with no working days makes every target unreachable and
      // would walk the day loop to its bound. Refused rather than stored.
      errors.push({ field: 'workingDays', message: 'sla.error.noWorkingDays' });
    } else {
      mask = daysToMask(days as number[]);
    }
  }

  const start =
    input.dayStartMinute === undefined ? current.day_start_minute : Number(input.dayStartMinute);
  const end =
    input.dayEndMinute === undefined ? current.day_end_minute : Number(input.dayEndMinute);

  const inRange = (value: number): boolean =>
    Number.isInteger(value) && value >= 0 && value <= 1440;

  if (!inRange(start) || !inRange(end) || end <= start) {
    errors.push({ field: 'dayEndMinute', message: 'sla.error.dayHoursInvalid' });
  }

  if (errors.length > 0) throw validationError(errors);

  return { name, timeZone, mask, start, end };
}

/**
 * Editing the calendar changes FUTURE targets only.
 *
 * FR-029 is what makes that true: a target's absolute time is stored when it is
 * computed, so nothing here reaches back and moves a commitment already made.
 * The controller returns `affectedOpenTickets: 0` for the same reason — it is
 * the first question an administrator will have, and answering it in the
 * interface is cheaper than answering it in support.
 */
export async function update(
  input: UpdateCalendarInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<CalendarView> {
  const calendar = await loadActive();
  const version = Number(input.version);

  if (!Number.isInteger(version) || version !== calendar.version) {
    throw staleRecord();
  }

  const next = validate(input, calendar);

  const previous = {
    timeZone: calendar.time_zone,
    workingDays: maskToDays(calendar.working_days),
    dayStartMinute: calendar.day_start_minute,
    dayEndMinute: calendar.day_end_minute,
  };

  await sequelize.transaction(async (transaction) => {
    calendar.name = next.name;
    calendar.time_zone = next.timeZone;
    calendar.working_days = next.mask;
    calendar.day_start_minute = next.start;
    calendar.day_end_minute = next.end;
    calendar.updated_by_user_id = actor.id;

    await calendar.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.CALENDAR_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'calendar',
        targetId: calendar.id,
        targetLabel: calendar.name,
        previousValue: previous,
        newValue: {
          timeZone: next.timeZone,
          workingDays: maskToDays(next.mask),
          dayStartMinute: next.start,
          dayEndMinute: next.end,
        },
        ...context,
      },
      transaction,
    );
  });

  return get();
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function addException(
  input: { date?: unknown; label?: unknown },
  actor: Actor,
  context: AuditContext = {},
): Promise<CalendarView> {
  const calendar = await loadActive();
  const date = String(input.date ?? '');

  if (!DATE_PATTERN.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw validationError([{ field: 'date', message: 'sla.error.exceptionDateInvalid' }]);
  }

  const existing = await CalendarException.findOne({
    where: { calendar_id: calendar.id, exception_date: date },
  });

  // Idempotent rather than an error: adding the same holiday twice is a
  // double-click, not a mistake worth refusing.
  if (existing) return get();

  const label =
    input.label === undefined || input.label === null ? null : String(input.label).trim();

  await sequelize.transaction(async (transaction) => {
    await CalendarException.create(
      { calendar_id: calendar.id, exception_date: date, label: label || null },
      { transaction },
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.CALENDAR_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'calendar',
        targetId: calendar.id,
        targetLabel: calendar.name,
        newValue: { exceptionAdded: date, label },
        ...context,
      },
      transaction,
    );
  });

  return get();
}

export async function removeException(
  id: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<CalendarView> {
  const calendar = await loadActive();
  const exception = await CalendarException.findOne({
    where: { id, calendar_id: calendar.id },
  });

  if (!exception) throw notFound();

  const date = exception.exception_date;

  await sequelize.transaction(async (transaction) => {
    await exception.destroy({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.CALENDAR_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'calendar',
        targetId: calendar.id,
        targetLabel: calendar.name,
        previousValue: { exceptionRemoved: date },
        ...context,
      },
      transaction,
    );
  });

  return get();
}
