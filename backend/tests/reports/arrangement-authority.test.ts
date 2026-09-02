import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DashboardArrangement, Role, RolePermission } from '../../src/models/index.js';
import { FIGURE_CATALOG } from '../../src/reporting/figures.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Arrangement authority (Phase 10, US6, FR-042, SC-019).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A FIGURE THE VIEWER CANNOT HAVE IS ABSENT, NOT AN ERROR.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The obvious implementation refuses: the layout references a figure, the figure
 * needs a permission, the permission is gone, so 403. That would make a
 * supervisor's whole dashboard fail because of one tile they never asked for —
 * and they could not tell it from an outage.
 *
 * The AI figures make this testable with real semantics rather than a contrived
 * one. Phase 9 made `ai:manage` administrator-only on purpose, so an admin sees
 * the AI tiles and a supervisor does not — the same catalog, two readers, two
 * dashboards, neither of them an error.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

const AI_KEYS = Object.entries(FIGURE_CATALOG)
  .filter(([, permission]) => permission === 'ai:manage')
  .map(([key]) => key);

describe('arrangement authority', () => {
  let admin: AuthedAgent;
  let supervisor: AuthedAgent;
  let supervisorId: number;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    admin = (await agentAs('admin')).agent;

    const created = await agentAs('supervisor');
    supervisor = created.agent;
    supervisorId = created.user.id;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('has at least one figure gated on a permission not everyone holds', () => {
    // Otherwise every assertion below would pass vacuously — a filter with
    // nothing to filter is indistinguishable from no filter at all.
    expect(AI_KEYS.length).toBeGreaterThan(0);
  });

  it('serves the AI figures to an administrator', async () => {
    const response = await admin.get(`/api/reports/dashboard?${PERIOD}`);

    expect(response.status).toBe(200);

    for (const key of AI_KEYS) {
      expect(Object.keys(response.body.figures), key).toContain(key);
    }
  });

  it('OMITS them for a supervisor — absent, and still a 200', async () => {
    const response = await supervisor.get(`/api/reports/dashboard?${PERIOD}`);

    // 200, not 403. The dashboard renders; one set of tiles is not there.
    expect(response.status).toBe(200);

    for (const key of AI_KEYS) {
      expect(Object.keys(response.body.figures), key).not.toContain(key);
    }

    // And the figures they DO hold are all present, so the omission is
    // targeted rather than the whole payload collapsing.
    expect(Object.keys(response.body.figures)).toContain('volume.received');
  });

  it('drops a saved tile the viewer has LOST authority for, without erroring', async () => {
    /**
     * The scenario SC-019 describes: a permission is revoked after a layout
     * referencing it was saved.
     *
     * Granting `ai:manage` to the supervisor role, saving the layout, then
     * revoking it — which is exactly the sequence that happens when somebody
     * changes roles.
     */
    const role = await Role.findOne({ where: { key: 'supervisor' } });
    expect(role).not.toBeNull();

    await RolePermission.create({ role_id: role!.id, permission_key: 'ai:manage' });

    try {
      const saved = await supervisor.put('/api/reports/dashboard/arrangement').send({
        layout: ['volume.received', AI_KEYS[0]],
      });

      expect(saved.status).toBe(200);
      expect(saved.body.layout).toContain(AI_KEYS[0]);
    } finally {
      await RolePermission.destroy({
        where: { role_id: role!.id, permission_key: 'ai:manage' },
      });
    }

    const after = await supervisor.get(`/api/reports/dashboard?${PERIOD}`);

    expect(after.status).toBe(200);
    expect(after.body.layout).toEqual(['volume.received']);

    /**
     * THE STORED ROW IS UNTOUCHED, and that is deliberate.
     *
     * Authority can be restored, and pruning the key on read would mean the
     * tile never comes back — the user would have to notice a tile they never
     * removed had gone, and re-add it. Filtering on read is reversible;
     * rewriting the row is not.
     */
    const row = await DashboardArrangement.findOne({ where: { user_id: supervisorId } });

    expect(row?.layout).toContain(AI_KEYS[0]);
  });

  it('does not offer an unreachable figure in the picker', async () => {
    const response = await supervisor.get('/api/reports/dashboard/arrangement');

    expect(response.status).toBe(200);

    // A picker offering a tile the dashboard would then omit is a trap: the
    // user adds it, saves successfully, and it does not appear.
    for (const key of AI_KEYS) {
      expect(response.body.available, key).not.toContain(key);
    }

    expect(response.body.available).toContain('volume.received');
  });
});
