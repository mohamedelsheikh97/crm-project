import { describe, expect, it } from 'vitest';

import {
  CalendarUnusableError,
  addWorkingMinutes,
  isKnownTimeZone,
  workingTimeBetween,
  zonedPartsOf,
  type WorkingCalendar,
} from '../../src/lib/business-hours.js';

/**
 * The highest-risk logic in Phase 6 (research D2).
 *
 * Every SLA number in the system is this arithmetic, and the default calendar
 * is Africa/Cairo — which REINSTATED DAYLIGHT SAVING IN 2023. A fixed-offset
 * implementation would be wrong by an hour for half the year in the project's
 * own default configuration, and wrong silently: targets would simply land at
 * the wrong time, with no error to notice.
 *
 * These tests are table-driven and cross a DST boundary in BOTH directions
 * deliberately. If this file is green, the rest of the SLA arithmetic is
 * arithmetic.
 */

// Sun-Thu, 09:00-17:00 Africa/Cairo — the seeded default (Clarifications Q1).
// 0b0011111 = 31: bits 0..4, and bit 0 is SUNDAY. The neighbouring value 62 is
// Mon..Fri, which is a different working week entirely — these two constants
// are one bit-shift apart and mean opposite things in this project's default
// locale, so they are spelled in binary here on purpose.
const CAIRO: WorkingCalendar = {
  timeZone: 'Africa/Cairo',
  workingDays: 0b0011111,
  dayStartMinute: 540,
  dayEndMinute: 1020,
  exceptions: new Set<string>(),
};

// Mon-Fri, 09:00-17:00 London — a second zone AND a different working week, so
// nothing accidentally depends on Cairo's particular rules.
const LONDON: WorkingCalendar = {
  timeZone: 'Europe/London',
  workingDays: 0b0111110,
  dayStartMinute: 540,
  dayEndMinute: 1020,
  exceptions: new Set<string>(),
};

/** Reads an instant back as a local wall-clock string, for readable failures. */
function local(instant: Date, calendar: WorkingCalendar): string {
  const p = zonedPartsOf(instant, calendar.timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** A local wall-clock time in the calendar's zone, as an instant. */
function at(calendar: WorkingCalendar, iso: string): Date {
  // Built by search rather than by construction so the helper itself cannot
  // encode the offset assumption under test.
  const [datePart, timePart] = iso.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);

  for (let offsetHours = -14; offsetHours <= 14; offsetHours += 0.25) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hh, mm) - offsetHours * 3_600_000);
    const p = zonedPartsOf(candidate, calendar.timeZone);

    if (p.year === y && p.month === m && p.day === d && p.hour === hh && p.minute === mm) {
      return candidate;
    }
  }

  throw new Error(`no instant matches ${iso} in ${calendar.timeZone}`);
}

describe('addWorkingMinutes — within one working day', () => {
  const cases: Array<[string, number, string]> = [
    // Sunday 2026-08-30 is a working day in the Cairo calendar.
    ['2026-08-30 09:00', 60, '2026-08-30 10:00'],
    ['2026-08-30 09:00', 480, '2026-08-30 17:00'], // exactly one working day
    ['2026-08-30 16:30', 15, '2026-08-30 16:45'],
  ];

  it.each(cases)('%s + %i working minutes = %s', (from, minutes, expected) => {
    const result = addWorkingMinutes(at(CAIRO, from), minutes, CAIRO);
    expect(local(result, CAIRO)).toBe(expected);
  });
});

describe('addWorkingMinutes — outside working hours (FR-025c)', () => {
  it('starts accruing at the next working moment, not immediately', () => {
    // 18:00 Sunday: the day is over. One working hour lands at 10:00 Monday,
    // NOT at 19:00 Sunday. This is the case that makes a ticket arriving in the
    // evening not already half-late by morning.
    const result = addWorkingMinutes(at(CAIRO, '2026-08-30 18:00'), 60, CAIRO);
    expect(local(result, CAIRO)).toBe('2026-08-31 10:00');
  });

  it('starts at opening when the clock begins before the working day', () => {
    const result = addWorkingMinutes(at(CAIRO, '2026-08-30 06:00'), 60, CAIRO);
    expect(local(result, CAIRO)).toBe('2026-08-30 10:00');
  });

  it('skips a non-working day entirely', () => {
    // Thursday 2026-09-03 is worked; Friday and Saturday are not. Four hours
    // from Thursday 15:00 uses the two before closing and finishes Sunday.
    const result = addWorkingMinutes(at(CAIRO, '2026-09-03 15:00'), 240, CAIRO);
    expect(local(result, CAIRO)).toBe('2026-09-06 11:00');
  });
});

describe('addWorkingMinutes — calendar exceptions (FR-027)', () => {
  it('extends a target by exactly the excluded day', () => {
    const withHoliday: WorkingCalendar = {
      ...CAIRO,
      exceptions: new Set(['2026-08-31']),
    };

    // One working day from Sunday 09:00 would normally end Sunday 17:00.
    // Two working days would reach Monday 17:00 — but Monday is a holiday, so
    // it lands on Tuesday instead.
    const plain = addWorkingMinutes(at(CAIRO, '2026-08-30 09:00'), 960, CAIRO);
    const holiday = addWorkingMinutes(at(CAIRO, '2026-08-30 09:00'), 960, withHoliday);

    expect(local(plain, CAIRO)).toBe('2026-08-31 17:00');
    expect(local(holiday, CAIRO)).toBe('2026-09-01 17:00');
  });
});

describe('daylight saving (FR-028) — the reason this module exists', () => {
  /**
   * Africa/Cairo runs DST from the last Friday in April to the last Thursday in
   * October since 2023. A duration expressed in hours must NOT change length
   * because a clock moved: four working hours is four working hours in April
   * and in November.
   */
  it('keeps a duration the same length across the spring transition', () => {
    // 2026-04-24 is the last Friday in April — a non-working day here, which is
    // itself the point: the transition happens over a weekend and must not leak
    // into the following Sunday's arithmetic.
    const before = addWorkingMinutes(at(CAIRO, '2026-04-23 10:00'), 120, CAIRO);
    const after = addWorkingMinutes(at(CAIRO, '2026-04-26 10:00'), 120, CAIRO);

    expect(local(before, CAIRO)).toBe('2026-04-23 12:00');
    expect(local(after, CAIRO)).toBe('2026-04-26 12:00');
  });

  it('keeps a duration the same length across the autumn transition', () => {
    const before = addWorkingMinutes(at(CAIRO, '2026-10-28 10:00'), 120, CAIRO);
    const after = addWorkingMinutes(at(CAIRO, '2026-11-01 10:00'), 120, CAIRO);

    expect(local(before, CAIRO)).toBe('2026-10-28 12:00');
    expect(local(after, CAIRO)).toBe('2026-11-01 12:00');
  });

  it('spans a transition without gaining or losing an hour', () => {
    // Across the whole transition weekend: Thursday 15:00 plus four working
    // hours must still land at Sunday 11:00 — two hours consumed on Thursday,
    // two on Sunday — whatever the clocks did in between.
    const result = addWorkingMinutes(at(CAIRO, '2026-04-23 15:00'), 240, CAIRO);
    expect(local(result, CAIRO)).toBe('2026-04-26 11:00');
  });

  it('measures the same span in both directions', () => {
    const from = at(CAIRO, '2026-04-23 10:00');
    const to = addWorkingMinutes(from, 300, CAIRO);

    expect(workingTimeBetween(from, to, CAIRO)).toBe(300 * 60_000);
  });
});

describe('workingTimeBetween', () => {
  it('counts only the working window within a day', () => {
    const from = at(CAIRO, '2026-08-30 08:00');
    const to = at(CAIRO, '2026-08-30 20:00');

    // 08:00-20:00 is twelve wall-clock hours and eight working ones.
    expect(workingTimeBetween(from, to, CAIRO)).toBe(480 * 60_000);
  });

  it('counts nothing across a non-working weekend', () => {
    const from = at(CAIRO, '2026-09-04 09:00'); // Friday
    const to = at(CAIRO, '2026-09-05 17:00'); // Saturday

    expect(workingTimeBetween(from, to, CAIRO)).toBe(0);
  });

  it('is zero when the end is not after the start', () => {
    const instant = at(CAIRO, '2026-08-30 10:00');

    expect(workingTimeBetween(instant, instant, CAIRO)).toBe(0);
    expect(workingTimeBetween(at(CAIRO, '2026-08-30 12:00'), instant, CAIRO)).toBe(0);
  });

  it('round-trips against addWorkingMinutes over many spans', () => {
    // The strongest property available: whatever the calendar does, the span
    // between `from` and `from + n` must measure n.
    const from = at(CAIRO, '2026-08-30 09:30');

    for (const minutes of [15, 60, 240, 479, 480, 481, 960, 2400]) {
      const to = addWorkingMinutes(from, minutes, CAIRO);
      expect(workingTimeBetween(from, to, CAIRO)).toBe(minutes * 60_000);
    }
  });
});

describe('a second zone and working week', () => {
  it('applies the London calendar independently of Cairo', () => {
    // Friday is worked in London and not in Cairo — proving the weekday mask
    // is read rather than assumed.
    const result = addWorkingMinutes(at(LONDON, '2026-09-04 15:00'), 240, LONDON);
    expect(local(result, LONDON)).toBe('2026-09-07 11:00');
  });
});

describe('an unusable calendar fails loudly rather than spinning', () => {
  it('refuses a week with no working days', () => {
    const nothing: WorkingCalendar = { ...CAIRO, workingDays: 0 };

    expect(() => addWorkingMinutes(new Date(), 60, nothing)).toThrow(CalendarUnusableError);
  });

  it('refuses a day that ends before it starts', () => {
    const inverted: WorkingCalendar = { ...CAIRO, dayStartMinute: 1020, dayEndMinute: 540 };

    expect(() => addWorkingMinutes(new Date(), 60, inverted)).toThrow(CalendarUnusableError);
  });
});

describe('isKnownTimeZone', () => {
  it('accepts real zones and refuses invented ones', () => {
    // Refused at the API boundary so an unknown zone can never throw inside a
    // scheduler sweep at 02:00.
    expect(isKnownTimeZone('Africa/Cairo')).toBe(true);
    expect(isKnownTimeZone('Europe/London')).toBe(true);
    expect(isKnownTimeZone('UTC')).toBe(true);
    expect(isKnownTimeZone('Middle/Earth')).toBe(false);
    expect(isKnownTimeZone('')).toBe(false);
    expect(isKnownTimeZone(null)).toBe(false);
  });
});
