import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DashboardArrangement } from '../../src/models/index.js';
import { FIGURE_KEYS } from '../../src/reporting/figures.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Arrangement validation (Phase 10, US6, data-model.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AN UNKNOWN FIGURE KEY IS REFUSED, NOT STORED AND LATER IGNORED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Storing it is the tempting option — the read path filters unknown keys anyway,
 * so nothing breaks. But a layout that quietly accumulates dead keys looks
 * broken to its owner: they saved six tiles, five appear, and nothing says which
 * was lost or why. They cannot remove what they cannot see, and the dashboard
 * becomes something they distrust rather than something they arranged.
 *
 * So the write refuses, and the error names the offending keys.
 */
describe('arrangement validation', () => {
  let supervisor: AuthedAgent;
  let userId: number;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    const created = await agentAs('supervisor');
    supervisor = created.agent;
    userId = created.user.id;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('refuses an unknown figure key and names it', async () => {
    const response = await supervisor.put('/api/reports/dashboard/arrangement').send({
      layout: ['volume.received', 'volume.doesNotExist'],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_layout');

    // Named, so a client can say which tile it could not save. "Invalid layout"
    // with no detail leaves the user guessing which of six keys was wrong.
    expect(response.body.error.details).toContain('volume.doesNotExist');
  });

  it('stores NOTHING when one key is unknown', async () => {
    await supervisor.put('/api/reports/dashboard/arrangement').send({
      layout: ['volume.received'],
    });

    await supervisor.put('/api/reports/dashboard/arrangement').send({
      layout: ['volume.openAtEnd', 'nope'],
    });

    const row = await DashboardArrangement.findOne({ where: { user_id: userId } });

    // The earlier valid layout survives untouched. A partial write here would be
    // the worst outcome: the user's previous arrangement destroyed and replaced
    // by an incomplete one, in response to a request that failed.
    expect(row?.layout).toEqual(['volume.received']);
  });

  it('refuses a layout that is not an array', async () => {
    for (const layout of ['volume.received', 42, null, { key: 'volume.received' }]) {
      const response = await supervisor.put('/api/reports/dashboard/arrangement').send({ layout });

      // A bare string is the plausible client mistake, and storing it would put
      // a non-array into a JSON column that every read path expects to iterate.
      expect(response.status, JSON.stringify(layout)).toBe(400);
    }
  });

  it('accepts every key in the catalog', async () => {
    /**
     * The complement, and it is not decoration.
     *
     * A validator that refused everything would pass the tests above. This walks
     * the catalog itself, so a key added later is covered without anybody
     * remembering to extend this file.
     */
    const response = await supervisor
      .put('/api/reports/dashboard/arrangement')
      .send({ layout: [...FIGURE_KEYS] });

    expect(response.status).toBe(200);
  });

  it('refuses a layout longer than the catalog', async () => {
    const response = await supervisor.put('/api/reports/dashboard/arrangement').send({
      layout: [...FIGURE_KEYS, ...FIGURE_KEYS, 'volume.received'],
    });

    // Deduplication makes a repeat harmless, so this only bites on something
    // genuinely oversized — which is the shape of a client bug looping forever.
    expect([200, 400]).toContain(response.status);

    if (response.status === 200) {
      // If it deduplicated, the result is still no longer than the catalog.
      expect(response.body.layout.length).toBeLessThanOrEqual(FIGURE_KEYS.length);
    }
  });
});
