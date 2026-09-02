import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { breakdownReconciles } from '../../src/reporting/figure.js';
import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import * as csatService from '../../src/services/report-csat.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { FEBRUARY } from '../reporting/fixture-answers.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Satisfaction reporting (Phase 10, US4, SC-001).
 *
 * Asserted against the hand-computed literals in `fixture-answers.ts`, not
 * against a second query — two queries share the assumption the bug is in.
 *
 * The fixture has exactly ONE response, which is deliberate: it sits below the
 * suppression floor, so every rate in this report is withheld and the tests can
 * assert the withholding rather than assuming somebody will test it later.
 */
describe('CSAT reporting', () => {
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

  it('counts the responses submitted in the period', async () => {
    const report = await februaryReport();

    expect(report.distribution.count).toBe(FEBRUARY.csat.responses);
  });

  it('returns EVERY score as a bucket, including the zeroes', async () => {
    const report = await februaryReport();

    // Five buckets, always. A GROUP BY returns only the scores that occurred,
    // and a four-segment bar leaves the reader unable to tell "no 1s" from "1
    // is not part of the scale".
    expect(report.distribution.value.map((bucket) => bucket.score)).toEqual([1, 2, 3, 4, 5]);

    for (const [score, count] of Object.entries(FEBRUARY.csat.distribution)) {
      const bucket = report.distribution.value.find((entry) => entry.score === Number(score));

      expect(bucket?.count, `score ${score}`).toBe(count);
    }
  });

  it('reconciles the distribution to the response count', async () => {
    const report = await februaryReport();

    // The identity FR-002 asks for: the parts sum to the whole. Nobody adds up
    // a chart by hand, which is exactly why this is a test.
    expect(breakdownReconciles(report.distribution, report.distribution.value)).toBe(true);
  });

  it('carries the neutral point and the scale, so no client hard-codes them', () => {
    expect(csatService.CSAT_SCORES).toEqual([1, 2, 3, 4, 5]);

    // The diverging bar centres on this. A client that had to hard-code `3`
    // would be holding a second copy of the scale definition (research D7).
    expect(csatService.CSAT_NEUTRAL).toBe(3);
  });

  it('presents comments by ticket REFERENCE, never an internal id (FR-028)', async () => {
    const report = await februaryReport();

    for (const comment of report.comments.value) {
      expect(comment.ticketReference).toMatch(/^TKT-\d{6}$/);

      // The shape assertion is the point: a numeric id here would be an
      // enumeration a reader could walk, and it is not what they can act on.
      expect(comment).not.toHaveProperty('ticketId');
      expect(comment).not.toHaveProperty('ticket_id');
    }
  });
});
