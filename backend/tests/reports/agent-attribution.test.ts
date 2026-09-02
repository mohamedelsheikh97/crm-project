import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { breakdownReconciles } from '../../src/reporting/figure.js';
import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import { Op } from 'sequelize';

import { Ticket, User } from '../../src/models/index.js';
import * as agentService from '../../src/services/report-agent.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { FEBRUARY } from '../reporting/fixture-answers.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Agent attribution (Phase 10, US5, FR-031, SC-012).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE TICKET, ONE AGENT. NEVER TWO.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The natural bug is a join that counts a reassigned ticket for everybody who
 * ever held it — every individual total is then inflated, the sum exceeds the
 * team's ticket count, and nobody notices because nobody adds up a report. It
 * is worse than an ordinary arithmetic error because the inflated numbers are
 * about people, and the people they are about cannot see them (FR-030).
 *
 * The rule is CURRENT ASSIGNEE (research D4, Open Question 1), stated in the
 * response so a client cannot render the figures without the definition.
 */
describe('agent attribution', () => {
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

  it('states the attribution rule in the response, not in a comment (FR-031)', async () => {
    const report = await februaryReport();

    expect(report.attributionRule.key).toBe('current_assignee');

    // `countsOnce` is the consequence somebody reimplementing this would get
    // wrong, so it is asserted rather than left to the prose.
    expect(report.attributionRule.countsOnce).toBe(true);
  });

  it('attributes by CURRENT assignee, matching the hand-computed answer', async () => {
    const report = await februaryReport();

    const byName = new Map(report.agents.value.map((row) => [row.name, row.assigned]));

    expect(byName.get('Agent A')).toBe(FEBRUARY.agents.agentA);
    expect(byName.get('Agent B')).toBe(FEBRUARY.agents.agentB);
  });

  it('counts a REASSIGNED ticket once, for the agent holding it now', async () => {
    const before = await februaryReport();

    const agentA = await User.findOne({ where: { email: 'agent-a@crm.local' } });
    const agentB = await User.findOne({ where: { email: 'agent-b@crm.local' } });

    expect(agentA).not.toBeNull();
    expect(agentB).not.toBeNull();

    /**
     * A ticket INSIDE the reported month, not merely the oldest one A holds.
     *
     * The fixture deliberately includes January tickets assigned to A, and
     * reassigning one of those would move nothing in February — the test would
     * fail on a fixture detail rather than on the attribution rule, which is
     * the least useful way for a test to fail.
     */
    const moved = await Ticket.findOne({
      where: {
        assignee_user_id: agentA!.id,
        created_at: {
          [Op.between]: [new Date('2026-02-01T00:00:00Z'), new Date('2026-02-28T23:59:59Z')],
        },
        merged_into_ticket_id: null,
      },
      order: [['id', 'ASC']],
    });

    expect(moved).not.toBeNull();

    // The reassignment. Only `assignee_user_id` changes; nothing records the
    // previous holder, which is exactly why the current-assignee rule is the
    // one the schema can honour (research D4).
    await Ticket.update({ assignee_user_id: agentB!.id } as never, {
      where: { id: moved!.id },
      silent: true,
    });

    const after = await februaryReport();

    const totals = (report: typeof after) =>
      new Map(report.agents.value.map((row) => [row.name, row.assigned]));

    // Moved off A...
    expect(totals(after).get('Agent A')).toBe((totals(before).get('Agent A') ?? 0) - 1);
    // ...and onto B. Not counted for both, and not lost.
    expect(totals(after).get('Agent B')).toBe((totals(before).get('Agent B') ?? 0) + 1);

    // THE INVARIANT, stated directly: the per-agent totals still sum to the
    // same attributed count. An attribution that counted the ticket twice would
    // pass both assertions above and fail this one.
    expect(after.agents.count).toBe(before.agents.count);
  });

  it('never sums to more than the tickets in the period', async () => {
    const report = await februaryReport();

    const summed = report.agents.value.reduce((total, row) => total + row.assigned, 0);

    expect(summed).toBe(report.agents.count);

    // And the unassigned tickets are the stated reason the breakdown is
    // narrower than the whole (FR-004) — the identity, not an approximation.
    expect(
      breakdownReconciles(
        report.agents,
        report.agents.value.map((row) => ({ count: row.assigned })),
      ),
    ).toBe(true);
  });

  it('reports the unassigned tickets as an exclusion rather than dropping them', async () => {
    const report = await februaryReport();

    const excluded = report.agents.excluded.find((entry) => entry.reason === 'no_assignee');

    // The null case that makes an agent breakdown not sum to the volume total.
    // Silent, it looks like a missing agent; stated, it is a fact about the
    // queue.
    expect(excluded?.count).toBe(FEBRUARY.agents.unassigned);
  });
});
