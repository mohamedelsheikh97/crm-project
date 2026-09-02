import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PERMISSIONS } from '../../src/auth/permissions.js';
import { Role, RolePermission } from '../../src/models/index.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Export authority (Phase 10, US3, contracts/reports-api.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `reports:export` IS NOT SUFFICIENT ON ITS OWN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The export endpoint requires it AND the exported report's own permission. If
 * it required only `reports:export`, then it would be a route to the agent
 * performance report for somebody without `reports:view_agents` — making
 * Clarifications Q1's decision cosmetic, through the one surface that produces
 * a file that can be forwarded to anyone.
 *
 * Agents hold NEITHER permission (FR-061): a team-wide aggregate lets an agent
 * infer a colleague's performance even without a per-agent breakdown.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

/** The permission list is objects, not strings; every assertion here is about keys. */
const KEYS = PERMISSIONS.map((permission) => permission.key);

describe('export authority', () => {
  let supervisor: AuthedAgent;
  let admin: AuthedAgent;
  let staffAgent: AuthedAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    supervisor = (await agentAs('supervisor')).agent;
    admin = (await agentAs('admin')).agent;
    staffAgent = (await agentAs('agent')).agent;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('declares the three reporting permissions', () => {
    // The permission list is the contract the seeder and the routes both read.
    // A rename that missed one of them would otherwise fail as a puzzling 403.
    expect(KEYS).toContain('reports:view');
    expect(KEYS).toContain('reports:view_agents');
    expect(KEYS).toContain('reports:export');
  });

  it('lets a supervisor export a report they can view', async () => {
    const response = await supervisor
      .post(`/api/reports/volume/export?${PERIOD}`)
      .send({ format: 'csv' });

    expect(response.status).toBe(200);
  });

  it('lets an admin export', async () => {
    const response = await admin.post(`/api/reports/sla/export?${PERIOD}`).send({ format: 'csv' });

    expect(response.status).toBe(200);
  });

  it('refuses an agent, who holds neither permission (FR-061)', async () => {
    const response = await staffAgent
      .post(`/api/reports/volume/export?${PERIOD}`)
      .send({ format: 'csv' });

    // 403, not 401 — they are authenticated and merely unauthorised.
    expect(response.status).toBe(403);
  });

  it('refuses `reports:export` ALONE — the dual check, proved (contracts/reports-api.md)', async () => {
    /**
     * THE ASSERTION THAT ACTUALLY PROVES THE SECOND CHECK EXISTS.
     *
     * The agent test above passes whether or not the controller checks the
     * report's own permission, because an agent holds neither — the route's
     * `reports:export` refuses them on its own. That makes it a weak test of
     * the thing this file is named after.
     *
     * So: grant the agent role `reports:export` and NOTHING else. The route
     * now lets them through. If the controller's own check were removed, this
     * would return 200 and an agent would hold the agent performance report in
     * a file. It must return 403.
     */
    const role = await Role.findOne({ where: { key: 'agent' } });
    expect(role).not.toBeNull();

    await RolePermission.create({ role_id: role!.id, permission_key: 'reports:export' });

    try {
      const response = await staffAgent
        .post(`/api/reports/volume/export?${PERIOD}`)
        .send({ format: 'csv' });

      expect(response.status).toBe(403);
    } finally {
      // Undone in a `finally` so a failure here cannot silently widen the
      // agent role for every test that runs after it in this file.
      await RolePermission.destroy({
        where: { role_id: role!.id, permission_key: 'reports:export' },
      });
    }
  });

  it('404s an unknown report rather than leaking whether it exists', async () => {
    const response = await supervisor
      .post(`/api/reports/not-a-report/export?${PERIOD}`)
      .send({ format: 'csv' });

    expect(response.status).toBe(404);
  });

  it('checks the report’s OWN authority, not only `reports:export`', async () => {
    /**
     * The assertion that would catch the defect this test exists for.
     *
     * The controller maps each exportable report to the permission its own
     * endpoint requires, and checks it AFTER the route's `reports:export`. If
     * somebody later adds the agent report to that map with `reports:view`
     * instead of `reports:view_agents`, this fails.
     */
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');

    const source = await readFile(
      path.resolve(import.meta.dirname, '../../src/controllers/reports/export.controller.ts'),
      'utf8',
    );

    const map = source.slice(source.indexOf('const REPORTS'), source.indexOf('} as const;'));

    // Every entry names a permission, and no entry defaults to none.
    const entries = [...map.matchAll(/(\w+):\s*\{\s*permission:\s*'([^']+)'/g)];

    expect(entries.length).toBeGreaterThan(0);

    for (const [, report, permission] of entries) {
      expect(KEYS, `${report} names an unknown permission`).toContain(permission);

      // The agent report, whenever it is added here, must carry the agent
      // permission. Named explicitly so the requirement survives the addition.
      if (report === 'agents' || report === 'agent') {
        expect(permission).toBe('reports:view_agents');
      }
    }
  });
});
