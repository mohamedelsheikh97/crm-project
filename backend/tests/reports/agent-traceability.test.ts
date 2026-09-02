import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import * as agentService from '../../src/services/report-agent.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Agent figure traceability (Phase 10, US5, FR-034, SC-013).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS REQUIREMENT CARRIES MORE WEIGHT AFTER CLARIFICATIONS Q1, NOT LESS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The agent a figure describes cannot see it (FR-030), so they cannot check it
 * themselves. Traceability is therefore the ONLY mechanism by which a disputed
 * figure can be settled at all: the supervisor has to be able to open the
 * tickets the number counted, on the agent's behalf, without writing a query.
 *
 * "In one step" is the testable part. Every row carries the agent id, and that
 * id is the ticket list's own filter — so the drill-through is a link a client
 * can construct from the figure, not a report somebody has to reproduce.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

describe('agent figure traceability', () => {
  let supervisor: AuthedAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    supervisor = (await agentAs('supervisor')).agent;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('carries the agent id on every row, so the drill-through needs no lookup', async () => {
    const period = await resolve(MONTH.from, MONTH.to);
    const report = await agentService.report(period, parse({}));

    expect(report.agents.value.length).toBeGreaterThan(0);

    for (const row of report.agents.value) {
      // A name alone would force the client to resolve it back to an id, and
      // two agents can share a name.
      expect(typeof row.agentId).toBe('number');
      expect(row.agentId).toBeGreaterThan(0);
    }
  });

  it('reaches the counted tickets in ONE step, through the ticket list', async () => {
    const period = await resolve(MONTH.from, MONTH.to);
    const report = await agentService.report(period, parse({}));

    const row = report.agents.value.find((entry) => entry.assigned > 0);
    expect(row).toBeDefined();

    /**
     * The same filter the figure used, applied to the surface the supervisor
     * already knows.
     *
     * If this returned a different count from the figure, the drill-through
     * would be worse than absent — it would look like a check and disagree with
     * the number it was checking, and nobody could tell which was wrong.
     */
    const drilled = await supervisor.get(
      `/api/tickets?assigneeId=${row!.agentId}` +
        `&createdFrom=${period.from.toISOString()}&createdTo=${period.to.toISOString()}`,
    );

    expect(drilled.status).toBe(200);

    const returned = (drilled.body.data ?? drilled.body.items ?? []) as unknown[];
    const total = drilled.body.meta?.total ?? drilled.body.total ?? returned.length;

    expect(total).toBe(row!.assigned);
  });

  it('states the period each agent was active, so a low count is readable (FR-032)', async () => {
    const period = await resolve(MONTH.from, MONTH.to);
    const report = await agentService.report(period, parse({}));

    for (const row of report.agents.value) {
      // A count of two in the month somebody joined is not performance, and the
      // reader cannot know that from the count alone.
      expect(row.activeFrom).toBeInstanceOf(Date);

      /**
       * `activeTo` is null even for a deactivated agent, and that is honest
       * rather than incomplete: nothing in the schema records WHEN somebody was
       * deactivated, and FR-035 forbids adding new monitoring of staff to find
       * out. A fabricated end date would be worse than an absent one.
       */
      expect(row.activeTo).toBeNull();
      expect(typeof row.active).toBe('boolean');
    }
  });

  it('is reachable by a supervisor with the attribution rule attached', async () => {
    const response = await supervisor.get(`/api/reports/agents?${PERIOD}`);

    expect(response.status).toBe(200);

    // The rule travels with the figures (FR-031). A supervisor settling a
    // dispute needs to know the number means "tickets they hold now", not
    // "tickets they worked on".
    expect(response.body.attributionRule.key).toBe('current_assignee');
  });
});
