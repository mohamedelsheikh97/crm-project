/**
 * WORKING-TIME ARITHMETIC (Phase 6, research.md D2).
 *
 * Two primitives, and everything else in the phase is built from them:
 *
 *   addWorkingTime(from, ms, calendar)      -> Date
 *   workingTimeBetween(from, to, calendar)  -> number
 *
 * NO RUNTIME DEPENDENCY, and that was a decision rather than an oversight.
 * Clarifications Q1 made every SLA number in the system depend on this, and the
 * default calendar is Africa/Cairo, which REINSTATED DAYLIGHT SAVING IN 2023 —
 * so a fixed-offset implementation would silently mis-time every target for half
 * the year in the project's own default configuration. A date library would be
 * correct and would also be a new dependency plus its transitive tail for two
 * pure functions, which does not clear the constitution's YAGNI bar. `Temporal`
 * would be the right answer and is not stable in Node 22.
 *
 * What is here instead is the standard Intl round trip: `formatToParts` to read
 * an instant as zoned wall-clock parts, and a two-pass guess-and-correct to go
 * back. Both are pure, and both are exhaustively testable against a table of
 * instants either side of a DST boundary — which is exactly what
 * tests/sla/business-hours.test.ts does.
 *
 * IF THAT TEST TABLE EVER PROVES THIS INSUFFICIENT, adopting `luxon` is a
 * contained swap behind these two functions and nothing above them changes.
 *
 * THE DAY WALK IS BOUNDED. A malformed calendar — every day marked non-working,
 * or a start after its end — must fail loudly rather than spin a scheduler
 * sweep forever. The API refuses both configurations, so reaching the bound
 * means something got past validation, and an exception is the right answer.
 */

/** The subset of a calendar row this module needs. Pure data, no model. */
export interface WorkingCalendar {
  timeZone: string;
  /** Bit 0 = Sunday. */
  workingDays: number;
  dayStartMinute: number;
  dayEndMinute: number;
  /** `YYYY-MM-DD` local dates that are not worked. */
  exceptions: ReadonlySet<string>;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1440;

/**
 * A hard stop on the day walk. 400 days is more than a year of non-working
 * days in a row, which no legitimate calendar produces.
 */
const MAX_DAYS_WALKED = 400;

export class CalendarUnusableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarUnusableError';
  }
}

/** Zoned wall-clock parts of an instant. */
interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

// One formatter per zone. Constructing an Intl.DateTimeFormat is expensive and
// the sweep calls this thousands of times; the set of zones in use is one.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, formatter);
  }

  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** True if the zone name is one this runtime understands. */
export function isKnownTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;

  try {
    // Throws RangeError for an unknown zone. Refusing here — at the API
    // boundary — is what keeps an unknown zone from throwing inside a sweep.
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** An instant, read as wall-clock parts in the calendar's zone. */
export function zonedPartsOf(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const lookup: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    // `hourCycle: 'h23'` still renders midnight as "24" in some ICU versions.
    hour: Number(lookup.hour) % 24,
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday: WEEKDAY_INDEX[lookup.weekday ?? ''] ?? 0,
  };
}

/** The zone's offset from UTC, in ms, at a given instant. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = zonedPartsOf(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Zoned wall-clock parts back to an instant.
 *
 * TWO PASSES, and the second one is the DST correction. Guessing the offset
 * from the naive UTC interpretation is wrong by an hour on the days either side
 * of a transition; re-reading the offset AT THE GUESS and applying it again
 * lands correctly everywhere except inside the skipped hour of a spring-forward,
 * where no such wall-clock time exists and the result clamps forward — which is
 * the behaviour a working day starting at 09:00 on a day that has no 09:00
 * should have anyway.
 */
export function instantFromZoned(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
): Date {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);

  const firstGuess = new Date(naive - offsetAt(new Date(naive), timeZone));
  const corrected = new Date(naive - offsetAt(firstGuess, timeZone));

  return corrected;
}

function localDateKey(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Whether a given local date is worked at all. */
function isWorkingDay(
  calendar: WorkingCalendar,
  year: number,
  month: number,
  day: number,
  weekday: number,
): boolean {
  if ((calendar.workingDays & (1 << weekday)) === 0) return false;
  return !calendar.exceptions.has(localDateKey(year, month, day));
}

function assertUsable(calendar: WorkingCalendar): void {
  if (calendar.workingDays === 0) {
    throw new CalendarUnusableError('calendar has no working days');
  }

  if (calendar.dayEndMinute <= calendar.dayStartMinute) {
    throw new CalendarUnusableError('calendar working day ends before it starts');
  }
}

/** A day, as the walk sees it. */
interface WalkDay {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

function nextDay(current: WalkDay): WalkDay {
  // Stepping through UTC is safe here because we only use it to advance the
  // CALENDAR date; the zoned instant is recomputed from the parts each time.
  const stepped = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));

  return {
    year: stepped.getUTCFullYear(),
    month: stepped.getUTCMonth() + 1,
    day: stepped.getUTCDate(),
    weekday: stepped.getUTCDay(),
  };
}

/**
 * The working minute-of-day an instant sits at within its own local day, and
 * whether that day is worked at all.
 */
function positionWithinDay(
  instant: Date,
  calendar: WorkingCalendar,
): { day: WalkDay; minuteOfDay: number; isWorking: boolean } {
  const parts = zonedPartsOf(instant, calendar.timeZone);
  const day: WalkDay = {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    weekday: parts.weekday,
  };

  return {
    day,
    // Seconds round UP to the next whole minute so a target is never reported
    // as met a fraction early.
    minuteOfDay: parts.hour * 60 + parts.minute + (parts.second > 0 ? 1 : 0),
    isWorking: isWorkingDay(calendar, day.year, day.month, day.day, day.weekday),
  };
}

/**
 * `from` plus `ms` of WORKING time (FR-025).
 *
 * A target computed outside working hours begins accruing at the next working
 * moment rather than consuming time nobody was working (FR-025c) — which is the
 * whole reason a ticket arriving at 18:00 is not already half-late by 09:00.
 */
export function addWorkingTime(from: Date, ms: number, calendar: WorkingCalendar): Date {
  assertUsable(calendar);

  if (ms <= 0) return new Date(from.getTime());

  const dayLengthMinutes = calendar.dayEndMinute - calendar.dayStartMinute;
  let remainingMinutes = ms / MS_PER_MINUTE;

  const start = positionWithinDay(from, calendar);
  let day = start.day;

  // Where in the first day we begin.
  //
  // The first day is usable only if it is worked AND we are not already past
  // its close. Starting before opening is fine — the clamp below moves the
  // cursor to opening, which is FR-025c: a target computed at 06:00 begins
  // accruing at 09:00 rather than consuming three hours nobody was working.
  //
  // WHEN IT IS NOT USABLE WE MUST ADVANCE THE DATE, not merely clear the flag.
  // Leaving `day` on today and falling into the loop would re-examine today as
  // a fresh full working day — so a ticket raised at 18:00 would be given the
  // whole of the day that had already ended, and land at 10:00 THAT MORNING,
  // in the past.
  let cursorMinute = calendar.dayStartMinute;
  let firstDay = start.isWorking && start.minuteOfDay < calendar.dayEndMinute;

  if (firstDay) {
    cursorMinute = Math.max(start.minuteOfDay, calendar.dayStartMinute);
  } else {
    day = nextDay(day);
  }

  let walked = 0;

  for (;;) {
    if (walked > MAX_DAYS_WALKED) {
      throw new CalendarUnusableError(
        `no working time found within ${MAX_DAYS_WALKED} days; the calendar is unusable`,
      );
    }

    if (firstDay || isWorkingDay(calendar, day.year, day.month, day.day, day.weekday)) {
      const availableMinutes = firstDay ? calendar.dayEndMinute - cursorMinute : dayLengthMinutes;
      const dayStart = firstDay ? cursorMinute : calendar.dayStartMinute;

      if (remainingMinutes <= availableMinutes) {
        return instantFromZoned(
          calendar.timeZone,
          day.year,
          day.month,
          day.day,
          dayStart + remainingMinutes,
        );
      }

      remainingMinutes -= availableMinutes;
    }

    firstDay = false;
    day = nextDay(day);
    walked += 1;
  }
}

/**
 * WORKING milliseconds between two instants. Zero if `to` is not after `from` —
 * a target already passed has no time left rather than negative time.
 */
export function workingTimeBetween(from: Date, to: Date, calendar: WorkingCalendar): number {
  assertUsable(calendar);

  if (to.getTime() <= from.getTime()) return 0;

  const start = positionWithinDay(from, calendar);
  const end = positionWithinDay(to, calendar);

  let day = start.day;
  let minutes = 0;
  let walked = 0;

  const endKey = localDateKey(end.day.year, end.day.month, end.day.day);

  for (;;) {
    if (walked > MAX_DAYS_WALKED) {
      throw new CalendarUnusableError(
        `span exceeds ${MAX_DAYS_WALKED} days; refusing to walk further`,
      );
    }

    const key = localDateKey(day.year, day.month, day.day);
    const isFirst = walked === 0;
    const isLast = key === endKey;

    if (isWorkingDay(calendar, day.year, day.month, day.day, day.weekday)) {
      const windowStart = isFirst
        ? Math.min(Math.max(start.minuteOfDay, calendar.dayStartMinute), calendar.dayEndMinute)
        : calendar.dayStartMinute;
      const windowEnd = isLast
        ? Math.min(Math.max(end.minuteOfDay, calendar.dayStartMinute), calendar.dayEndMinute)
        : calendar.dayEndMinute;

      if (windowEnd > windowStart) minutes += windowEnd - windowStart;
    }

    if (isLast) break;

    day = nextDay(day);
    walked += 1;
  }

  return minutes * MS_PER_MINUTE;
}

/** Convenience for callers holding working MINUTES, which is how policies store them. */
export function addWorkingMinutes(from: Date, minutes: number, calendar: WorkingCalendar): Date {
  return addWorkingTime(from, minutes * MS_PER_MINUTE, calendar);
}

/** Exported for the declaration test; not used in a decision. */
export const INTERNALS = { MINUTES_PER_DAY, MAX_DAYS_WALKED };
