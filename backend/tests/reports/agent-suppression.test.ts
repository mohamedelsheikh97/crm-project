import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import { SUPPRESSION_FLOOR } from '../../src/reporting/suppression.js';
import { Customer, Ticket, User } from '../../src/models/index.js';
import * as agentService from '../../src/services/report-agent.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * The suppression floor on agent figures (Phase 10, US5, FR-036, SC-014).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO INDIVIDUAL IS CHARACTERISED BY A HANDFUL OF TICKETS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "50% resolution rate" over two tickets is not a measurement, and it is a
 * sentence about a person who — under Clarifications Q1 — cannot see it and so
 * cannot answer it. Below the floor the RATES are withheld and the counts
 * shown; the counts are facts and stay.
 *
 * This file asserts both directions, because a suppression that never lifts is
 * indistinguishable from a broken query.
 */
describe('agent figure suppression', () => {
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
    return agentService.report(period, parse({}));
  }

  it('withholds every rate for an agent below the floor', async () => {
    const report = await februaryReport();

    const thin = report.agents.value.filter((row) => row.assigned < SUPPRESSION_FLOOR);

    // The fixture has one: Agent B, with a single ticket.
    expect(thin.length).toBeGreaterThan(0);

    for (const row of thin) {
      expect(row.suppressed, row.name).toBe(true);

      // `null`, not 0 and not the real ratio. Zero reads as "resolved nothing";
      // the real ratio reads as reliable. Both are claims one ticket cannot
      // support.
      expect(row.settledRate, row.name).toBeNull();
      expect(row.responseCompliance, row.name).toBeNull();
      expect(row.resolutionCompliance, row.name).toBeNull();
    }
  });

  it('keeps the COUNTS, which are facts rather than characterisations', async () => {
    const report = await februaryReport();

    for (const row of report.agents.value) {
      // Suppressing the counts too would leave a supervisor unable to see that
      // somebody had one ticket — which is the very context that makes the
      // missing rate make sense.
      expect(typeof row.assigned).toBe('number');
      expect(typeof row.settled).toBe('number');
      expect(row.assigned).toBeGreaterThanOrEqual(row.settled);
    }
  });

  it('LIFTS the suppression once an agent reaches the floor', async () => {
    const agentB = await User.findOne({ where: { email: 'agent-b@crm.local' } });
    const customer = await Customer.findOne();

    expect(agentB).not.toBeNull();
    expect(customer).not.toBeNull();

    const before = await februaryReport();
    const held = before.agents.value.find((row) => row.name === 'Agent B')?.assigned ?? 0;

    for (let index = held; index < SUPPRESSION_FLOOR; index += 1) {
      const created = (await Ticket.create({
        customer_id: customer!.id,
        subject: `FEB filler ${index}`,
        description: 'to reach the suppression floor',
        category: 'general',
        priority: 'normal',
        // Half resolved, so the rate that appears is not 0 or 1 — a rate at
        // either extreme could be produced by a bug that ignored the data.
        status: index % 2 === 0 ? 'resolved' : 'open',
        source: 'email',
        assignee_user_id: agentB!.id,
      } as never)) as unknown as { id: number };

      // Sequelize stamps NOW on insert; the fixture's dates are what the report
      // reads, so the creation date is set explicitly afterwards.
      await Ticket.update({ created_at: new Date(Date.UTC(2026, 1, 14 + index)) } as never, {
        where: { id: created.id },
        silent: true,
      });
    }

    const after = await februaryReport();
    const row = after.agents.value.find((entry) => entry.name === 'Agent B');

    expect(row).toBeDefined();
    expect(row!.assigned).toBe(SUPPRESSION_FLOOR);

    // The floor is a floor, not a blanket refusal.
    expect(row!.suppressed).toBe(false);
    expect(row!.settledRate).not.toBeNull();

    // And the rate is neither extreme, so it cannot have come from a query that
    // ignored the statuses.
    expect(row!.settledRate!).toBeGreaterThan(0);
    expect(row!.settledRate!).toBeLessThan(1);
  });

  it('applies the SAME floor the other reports use', async () => {
    /**
     * One declaration, four requirements (FR-006, FR-029, FR-036, FR-061).
     *
     * Asserting the constant rather than the literal 5 is what makes Open
     * Question 3 — tuning the floor against real distributions — a one-line
     * change rather than a search across four services.
     */
    const report = await februaryReport();

    for (const row of report.agents.value) {
      expect(row.suppressed).toBe(row.assigned < SUPPRESSION_FLOOR);
    }
  });
});
