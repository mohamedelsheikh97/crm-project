import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import * as csatService from '../../src/services/report-csat.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { FEBRUARY } from '../reporting/fixture-answers.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * The CSAT response-rate denominator (Phase 10, US4, FR-027, SC-010).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A RESPONSE RATE COMPUTED OVER THE RESPONSES IS ALWAYS 100%.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That is the bug this file exists for, and it is an easy one to ship: the
 * tickets that were never rated have NO ROW in `ticket_satisfaction`, so the
 * query that feels natural — join, group, divide — omits exactly the records the
 * figure exists to count. The result looks plausible, is never zero, and is
 * wrong in a direction nobody questions.
 *
 * The fixture is built so the two numbers differ: three settled tickets, one
 * rated.
 */
describe('CSAT response rate', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  async function februaryReport() {
    const period = await resolve(MONTH.from, MONTH.to);
    return csatService.report(period, parse({}));
  }

  it('counts every ticket that COULD have been rated, not just the rated ones', async () => {
    const report = await februaryReport();

    expect(report.responseRate.total).toBe(FEBRUARY.csat.rateableTickets);

    // THE INEQUALITY IS THE REQUIREMENT. If the denominator equalled the
    // numerator, the rate would be 100% and this test would be the only thing
    // that noticed.
    expect(report.responseRate.total).not.toBe(report.responseRate.count);
    expect(report.responseRate.count).toBe(FEBRUARY.csat.responses);
  });

  it('states how many were never rated (FR-004)', async () => {
    const report = await februaryReport();

    const unrated = report.responseRate.excluded.find((entry) => entry.reason === 'not_rated');

    // Stated, not silent. An unrated ticket is the whole substance of a
    // response rate, and a figure that quietly narrowed to the rated ones would
    // look complete.
    expect(unrated?.count).toBe(FEBRUARY.csat.rateableTickets - FEBRUARY.csat.responses);
  });

  it('withholds the rate itself while the denominator is below the floor', async () => {
    const report = await februaryReport();

    // Three rateable tickets is below the floor. `null`, not `0.33` and not
    // `0` — one third of three is not a rate anybody should act on.
    expect(report.responseRate.suppressed).toBe(FEBRUARY.csat.responseRateSuppressed);
    expect(report.responseRate.value).toBeNull();
  });

  it('still reports the counts while withholding the rate', async () => {
    const report = await februaryReport();

    // The reader is not left with nothing. "1 of 3 rated" is true and useful;
    // "33%" is neither.
    expect(report.responseRate.count).toBeGreaterThan(0);
    expect(report.responseRate.total).toBeGreaterThan(report.responseRate.count);
  });
});
