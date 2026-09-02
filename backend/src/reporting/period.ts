import { instantFromZoned, zonedPartsOf } from '../lib/business-hours.js';
import * as calendarService from '../services/calendar.service.js';

import type { ResolvedPeriod } from './figure.js';

/**
 * A requested date range becomes absolute instants (Phase 10, research D5).
 *
 * ONE TIMEZONE, FROM THE ACTIVE BUSINESS CALENDAR. The spec's Assumptions fixed
 * this rather than offering a per-user preference, and the reason is that two
 * managers reading the same report must not see different period boundaries.
 *
 * RESOLVED ONCE PER REQUEST, NOT PER QUERY, and that is what makes FR-002
 * achievable. A total and its breakdown computed against two independently
 * resolved boundaries can differ by a day's worth of tickets — which is exactly
 * the "two figures that must agree, disagreeing" failure FR-002 exists to
 * prevent, and it would look like a rounding problem rather than a bug.
 *
 * NO NEW ARITHMETIC HERE. `lib/business-hours.ts` already converts between
 * zoned parts and instants, and `calendar.service.workingCalendar()` already
 * loads the active calendar. Research D2 forbids restating either — including
 * FR-013's daylight-saving and calendar-exception handling, which is already
 * solved there and must not be solved again.
 */
export class InvalidPeriodError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'InvalidPeriodError';
  }
}

/** Guards against a request that would scan years (FR-052's sibling). */
const MAX_DAYS = 400;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date, not merely a well-shaped string.
 *
 * THE REGEX ALONE IS NOT ENOUGH, and the gap is not obvious: `2026-13-01`
 * matches it, and `Date.UTC` treats month 13 as January of the following year.
 * So an invalid month silently resolves to a valid period twelve months away —
 * a report for a month that does not exist, quietly answered with a different
 * month's data. `2026-02-30` fails the same way, rolling into March.
 *
 * Round-tripping through UTC catches both: if the parts that come back out
 * differ from the ones that went in, the date was never real.
 */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const probe = new Date(Date.UTC(year, month - 1, day));

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Resolves `from` and `to` date strings into instants.
 *
 * `from` is the FIRST instant of that local date; `to` is the LAST instant of
 * that local date — inclusive, because a manager asking for "1st to 31st"
 * means the whole of the 31st. An exclusive upper bound is the classic
 * off-by-one that silently drops a day from every monthly report.
 */
export async function resolve(from: unknown, to: unknown): Promise<ResolvedPeriod> {
  if (typeof from !== 'string' || !DATE_ONLY.test(from)) {
    throw new InvalidPeriodError('from must be a YYYY-MM-DD date');
  }

  if (typeof to !== 'string' || !DATE_ONLY.test(to)) {
    throw new InvalidPeriodError('to must be a YYYY-MM-DD date');
  }

  const calendar = await calendarService.workingCalendar();
  const timeZone = calendar.timeZone;

  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number) as [number, number, number];
  const [toYear, toMonth, toDay] = to.split('-').map(Number) as [number, number, number];

  if (!isRealDate(fromYear, fromMonth, fromDay)) {
    throw new InvalidPeriodError('from is not a real calendar date');
  }

  if (!isRealDate(toYear, toMonth, toDay)) {
    throw new InvalidPeriodError('to is not a real calendar date');
  }

  const start = instantFromZoned(timeZone, fromYear, fromMonth, fromDay, 0);

  // The last instant of the requested day: midnight of the day after, minus a
  // millisecond. Expressed as minute-of-day 1440 on the same date rather than as
  // 23:59 so a daylight-saving transition inside the final day cannot shorten
  // it — `instantFromZoned` resolves the offset for the resulting instant.
  const dayAfter = instantFromZoned(timeZone, toYear, toMonth, toDay, 24 * 60);

  const end = new Date(dayAfter.getTime() - 1);

  if (end.getTime() < start.getTime()) {
    throw new InvalidPeriodError('to must not be before from');
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);

  if (days > MAX_DAYS) {
    throw new InvalidPeriodError(`period must not exceed ${MAX_DAYS} days`);
  }

  return { from: start, to: end, timeZone };
}

/**
 * Buckets a resolved period for a time series, in the period's own timezone.
 *
 * Day buckets up to about two months, then weeks, then months — so a chart never
 * has four hundred columns and never has three.
 */
export type BucketSize = 'day' | 'week' | 'month';

export function bucketSizeFor(period: ResolvedPeriod): BucketSize {
  const days = Math.round((period.to.getTime() - period.from.getTime()) / 86_400_000);

  if (days <= 62) return 'day';
  if (days <= 210) return 'week';
  return 'month';
}

/**
 * The local-date label an instant falls in, for grouping a series.
 *
 * Uses the period's timezone rather than the server's, so a ticket created at
 * 23:30 local time is counted on the day the customer experienced, not the day
 * UTC happened to be on.
 */
export function bucketKey(instant: Date, period: ResolvedPeriod, size: BucketSize): string {
  const parts = zonedPartsOf(instant, period.timeZone);
  const month = String(parts.month).padStart(2, '0');

  if (size === 'month') return `${parts.year}-${month}`;

  const day = String(parts.day).padStart(2, '0');

  if (size === 'day') return `${parts.year}-${month}-${day}`;

  // Week buckets are labelled by the local date of the bucket's first day,
  // counted from the period's own start rather than from an ISO week boundary —
  // a report for the 5th to the 25th should not open with a partial week.
  const dayIndex = Math.floor((instant.getTime() - period.from.getTime()) / 86_400_000);
  const weekStart = new Date(period.from.getTime() + Math.floor(dayIndex / 7) * 7 * 86_400_000);
  const startParts = zonedPartsOf(weekStart, period.timeZone);

  return `${startParts.year}-${String(startParts.month).padStart(2, '0')}-${String(
    startParts.day,
  ).padStart(2, '0')}`;
}
