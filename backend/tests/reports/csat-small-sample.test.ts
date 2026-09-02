import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import { SUPPRESSION_FLOOR } from '../../src/reporting/suppression.js';
import { Customer, Ticket, TicketSatisfaction } from '../../src/models/index.js';
import * as csatService from '../../src/services/report-csat.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { FEBRUARY } from '../reporting/fixture-answers.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * The small-sample floor on CSAT (Phase 10, US4, FR-029, SC-009, SC-011).
 *
 * "Average satisfaction: 4.0" reads identically over one response and over four
 * hundred, and a manager acting on the first is acting on noise. Below the floor
 * the average is WITHHELD and the count is shown instead.
 *
 * This file asserts BOTH SIDES — withheld below the floor, and present above it
 * — because a suppression rule that never lifts is indistinguishable from a
 * broken query, and a test that only checks the withholding would pass for a
 * report that suppressed everything forever.
 */
describe('CSAT small samples', () => {
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

  it('withholds an average over fewer responses than the floor', async () => {
    const report = await februaryReport();

    expect(report.average.suppressed).toBe(FEBRUARY.csat.averageSuppressed);

    // `null`, not a number. Zero would read as "nobody was satisfied" and the
    // real average would read as reliable; both are claims one response cannot
    // support.
    expect(report.average.value).toBeNull();
  });

  it('shows the count instead, so the reader has something true', async () => {
    const report = await februaryReport();

    // Suppression withholds the RATE, not the fact. "1 response" is honest and
    // tells the reader why the average is missing.
    expect(report.average.count).toBe(FEBRUARY.csat.responses);
  });

  it('keeps the distribution visible even while the average is withheld', async () => {
    const report = await februaryReport();

    /**
     * A COUNT IS NOT A RATE, and the floor applies to rates.
     *
     * Suppressing the distribution too would hide the one thing that is
     * unambiguously true — that a single customer scored a 4 — and would leave
     * the screen empty for a reason nobody could distinguish from an outage.
     */
    expect(report.distribution.suppressed).toBe(false);
    expect(report.distribution.value.some((bucket) => bucket.count > 0)).toBe(true);
  });

  it('LIFTS the suppression once the floor is reached', async () => {
    /**
     * The other side of the rule, and the assertion that proves it is a floor
     * rather than a blanket refusal.
     *
     * Adds responses up to the floor and re-reads. A suppression that never
     * lifts looks exactly like a broken query to the person using the report.
     */
    expect(await TicketSatisfaction.count()).toBe(1);

    const customer = await Customer.findOne();
    expect(customer).not.toBeNull();

    /**
     * A NEW TICKET PER RATING, because one ticket is rated at most once —
     * `ticket_satisfaction` is unique on `ticket_id`, which is Phase 8's rule
     * and the right one. Reusing a ticket here would fail on the constraint,
     * and working around the constraint would be testing something the product
     * cannot do.
     */
    for (let index = 0; index < SUPPRESSION_FLOOR - 1; index += 1) {
      const ticket = (await Ticket.create({
        customer_id: customer!.id,
        subject: `FEB extra rated ${index}`,
        description: 'for the suppression floor',
        category: 'general',
        priority: 'normal',
        status: 'resolved',
        source: 'email',
        assignee_user_id: null,
      } as never)) as unknown as { id: number };

      await TicketSatisfaction.create({
        ticket_id: ticket.id,
        // A 2 each time, so the average must MOVE — a report returning the
        // original 4 would prove the new rows were not read.
        score: 2,
        comment: null,
        submitted_by_contact_id: null,
        submitted_at: new Date(Date.UTC(2026, 1, 8 + index)),
      } as never);
    }

    const report = await februaryReport();

    expect(report.average.count).toBe(SUPPRESSION_FLOOR);
    expect(report.average.suppressed).toBe(false);

    // (4 + 2×4) / 5 = 2.4
    expect(report.average.value).toBeCloseTo(
      (4 + 2 * (SUPPRESSION_FLOOR - 1)) / SUPPRESSION_FLOOR,
      10,
    );
  });
});
