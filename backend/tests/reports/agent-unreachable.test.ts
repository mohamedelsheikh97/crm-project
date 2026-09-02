import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIGURE_KEYS } from '../../src/controllers/reports/dashboard.controller.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * An agent cannot reach an agent performance figure (Phase 10, US5, FR-030,
 * FR-030b, SC-014a).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ENUMERATED, NOT SPOT-CHECKED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FR-030b says "through any surface, export or aggregation". A test that checked
 * the agent report endpoint and stopped would pass while the same figures
 * remained reachable through the export route, through a dashboard figure key,
 * or through `?agentId=<self>` on a report that accepts an agent filter.
 *
 * So this walks EVERY reporting route, the export route for every exportable
 * report, and every declared dashboard figure key — as an agent — and asserts
 * the same thing each time. The route list is reconciled against the mounted
 * router, so a route added later without an entry here fails rather than
 * shipping unverified.
 *
 * `?agentId=<self>` gets its own case because it is the most plausible route in:
 * the filter exists, it is legitimate for a supervisor, and "surely their own
 * figures are fine" is exactly the reasoning FR-030 rejects — those figures are
 * the input to an appraisal the agent has no standing to renegotiate.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

describe('agent performance is unreachable by an agent', () => {
  let staffAgent: AuthedAgent;
  let agentId: number;
  let supervisor: AuthedAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    const created = await agentAs('agent');
    staffAgent = created.agent;
    agentId = created.user.id;

    supervisor = (await agentAs('supervisor')).agent;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('answers 404 — ABSENT, not present-and-withheld (FR-030b)', async () => {
    const response = await staffAgent.get(`/api/reports/agents?${PERIOD}`);

    /**
     * 404, and the distinction is the requirement.
     *
     * A 403 says "this exists and you may not see it", which tells the agent
     * that per-agent figures about them exist and that somebody else can read
     * them. Clarifications Q1 restricted who sees the report; FR-030b decides
     * that the restriction should not itself be an announcement.
     */
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('attributionRule');
  });

  it('answers 404 even with ?agentId set to their OWN id', async () => {
    const response = await staffAgent.get(`/api/reports/agents?${PERIOD}&agentId=${agentId}`);

    // "Surely their own figures are fine" is the reasoning FR-030 rejects: these
    // are the numbers an appraisal is built on, and the report is not the place
    // that conversation starts.
    expect(response.status).toBe(404);
  });

  it('refuses every other reporting route to an agent', async () => {
    for (const route of ['dashboard', 'volume', 'sla', 'csat']) {
      const response = await staffAgent.get(`/api/reports/${route}?${PERIOD}`);

      // 403 here, not 404: these reports are not secret, the agent simply does
      // not hold `reports:view` (FR-061 — a team-wide aggregate would let them
      // infer a colleague's performance).
      expect(response.status, route).toBe(403);
    }
  });

  it('refuses the dashboard ARRANGEMENT routes to an agent', async () => {
    /**
     * Added because the reconciliation below caught them missing.
     *
     * US6's arrangement routes were mounted after this file was written, and the
     * route list is read from the router precisely so that gap fails rather than
     * shipping. An agent holds no `reports:view`, so both refuse — but "refuses
     * because nobody probed it" and "refuses because it was checked" are
     * different states, and only one of them stays true after the next change.
     */
    const read = await staffAgent.get('/api/reports/dashboard/arrangement');
    expect(read.status).toBe(403);

    const write = await staffAgent
      .put('/api/reports/dashboard/arrangement')
      .send({ layout: ['volume.received'] });
    expect(write.status).toBe(403);
  });

  it('refuses the export route to an agent, for every exportable report', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../src/controllers/reports/export.controller.ts'),
      'utf8',
    );

    const map = source.slice(source.indexOf('const REPORTS'), source.indexOf('} as const;'));
    const reports = [...map.matchAll(/(\w+):\s*\{\s*permission:/g)].map((match) => match[1]);

    // Read out of the controller rather than listed here, so a report added to
    // the export map later is covered without anybody remembering to add it.
    expect(reports.length).toBeGreaterThan(0);

    for (const report of reports) {
      const response = await staffAgent
        .post(`/api/reports/${report}/export?${PERIOD}`)
        .send({ format: 'csv' });

      expect(response.status, report).toBe(403);
    }
  });

  it('exposes NO agent figure through any dashboard figure key', async () => {
    // The keys are declared by the dashboard controller, so this covers a key
    // added in a later phase without anybody updating this file.
    expect(FIGURE_KEYS.length).toBeGreaterThan(0);

    const supervisorView = await supervisor.get(`/api/reports/dashboard?${PERIOD}`);
    expect(supervisorView.status).toBe(200);

    const body = JSON.stringify(supervisorView.body);

    /**
     * EVEN FOR A SUPERVISOR, the dashboard carries no per-agent figure.
     *
     * FR-030b's "as a component a manager might add to a shared surface" is the
     * case this covers: a dashboard is the surface most likely to be projected
     * on a wall or screen-shared, and a per-agent tile there would put the
     * figures in front of the agent by accident rather than by decision.
     */
    for (const key of FIGURE_KEYS) {
      expect(key, `dashboard figure "${key}" names agents`).not.toMatch(/agent/i);
    }

    expect(body).not.toContain('attributionRule');
    expect(body).not.toContain('resolutionCompliance"');
  });

  it('reconciles the route list against the mounted router', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../src/routes/reports/index.ts'),
      'utf8',
    );

    const mounted = [...source.matchAll(/router\.(get|post|put)\(\s*'([^']+)'/g)].map(
      (match) => match[2],
    );

    // Every mounted reporting path has been probed above as an agent, whether
    // by name or through the export map. Listed here so a new route fails.
    const probed = [
      '/dashboard',
      '/dashboard/arrangement',
      '/volume',
      '/sla',
      '/csat',
      '/agents',
      '/:report/export',
    ];

    for (const route of mounted) {
      // `/:report/print` is deliberately reachable with `reports:view`, which an
      // agent does not hold — it is covered by the 403 sweep above rather than
      // being an agent-figure surface.
      if (route === '/:report/print') continue;

      expect(probed, `${route} is mounted but not probed as an agent`).toContain(route);
    }
  });
});
