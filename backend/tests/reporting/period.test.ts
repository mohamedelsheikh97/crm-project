import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bucketKey,
  bucketSizeFor,
  InvalidPeriodError,
  resolve,
} from '../../src/reporting/period.js';
import * as calendarService from '../../src/services/calendar.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { REQUIRED_TIME_ZONE } from './fixture-answers.js';
import { ensureUtcCalendar } from './fixture.js';

/**
 * Period resolution (Phase 10, research D5, FR-009, FR-013).
 *
 * The figures in `fixture-answers.ts` are counted against UTC instants, so the
 * first test here is not about periods at all — it asserts the assumption every
 * other hand-computed answer rests on. Without it, a machine in another timezone
 * would shift every boundary and every number in that file would be wrong for a
 * reason nobody would think to look for.
 */
describe('period resolution', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('runs against a UTC calendar, which every hand-computed answer assumes', async () => {
    const calendar = await calendarService.workingCalendar();

    expect(
      calendar.timeZone,
      'the fixture answers are counted in UTC; a different calendar timezone invalidates them',
    ).toBe(REQUIRED_TIME_ZONE);
  });

  it('includes the whole of the final day', async () => {
    const period = await resolve('2026-02-01', '2026-02-28');

    // An EXCLUSIVE upper bound is the classic off-by-one that silently drops a
    // day from every monthly report — and drops it from the total and the
    // breakdown alike, so the parts still sum and nothing looks wrong.
    expect(period.from.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('resolves one period per request, so every figure shares a boundary', async () => {
    const first = await resolve('2026-02-01', '2026-02-28');
    const second = await resolve('2026-02-01', '2026-02-28');

    // FR-002 depends on this: a total and its breakdown resolved against
    // independently-computed bounds can differ by a day's worth of tickets, and
    // it would read as a rounding problem rather than a bug.
    expect(first.from.getTime()).toBe(second.from.getTime());
    expect(first.to.getTime()).toBe(second.to.getTime());
  });

  it('does not lose or double-count a day across a period containing a DST change', async () => {
    // A period spanning the northern-hemisphere spring transition. Under UTC
    // there is no shift, which is the point of pinning the calendar to UTC — but
    // the day count must still be exact.
    const period = await resolve('2026-03-01', '2026-03-31');
    const days = (period.to.getTime() + 1 - period.from.getTime()) / 86_400_000;

    expect(days).toBe(31);
  });

  it('refuses a malformed or reversed range rather than guessing', async () => {
    await expect(resolve('yesterday', '2026-02-28')).rejects.toBeInstanceOf(InvalidPeriodError);
    // Month 13 matches the regex and Date.UTC rolls it into January 2027, so
    // without a real-date check this resolves to a period twelve months away
    // and answers a report for a month that does not exist.
    await expect(resolve('2026-02-01', '2026-13-01')).rejects.toBeInstanceOf(InvalidPeriodError);
    // Same failure shape: February 30th rolls into March.
    await expect(resolve('2026-02-30', '2026-03-01')).rejects.toBeInstanceOf(InvalidPeriodError);
    await expect(resolve('2026-02-28', '2026-02-01')).rejects.toBeInstanceOf(InvalidPeriodError);
  });

  it('refuses a period long enough to scan the table', async () => {
    await expect(resolve('2020-01-01', '2026-12-31')).rejects.toBeInstanceOf(InvalidPeriodError);
  });

  it('chooses a bucket size that keeps a chart readable', async () => {
    expect(bucketSizeFor(await resolve('2026-02-01', '2026-02-28'))).toBe('day');
    expect(bucketSizeFor(await resolve('2026-01-01', '2026-05-31'))).toBe('week');
    expect(bucketSizeFor(await resolve('2025-06-01', '2026-05-31'))).toBe('month');
  });

  it('buckets an instant by its LOCAL date, not the server day', async () => {
    const period = await resolve('2026-02-01', '2026-02-28');
    const lateEvening = new Date('2026-02-10T23:30:00.000Z');

    // A ticket raised at 23:30 local time belongs to the day the customer
    // experienced, not to whichever day UTC happened to be on.
    expect(bucketKey(lateEvening, period, 'day')).toBe('2026-02-10');
    expect(bucketKey(lateEvening, period, 'month')).toBe('2026-02');
  });
});
