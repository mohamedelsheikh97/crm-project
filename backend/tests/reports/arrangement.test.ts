import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_LAYOUT } from '../../src/services/dashboard-arrangement.service.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Dashboard arrangements (Phase 10, US6, FR-040, FR-041, SC-016).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE ARRANGEMENT PER PERSON, AND NO ROUTE TO ANYBODY ELSE'S.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The endpoint takes no id — the user comes from the session. This file asserts
 * the consequence rather than the implementation: two supervisors save different
 * layouts, and each reads back their own. A shared row, or an id parameter with
 * a missing check, fails here.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

describe('dashboard arrangements', () => {
  let first: AuthedAgent;
  let second: AuthedAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    first = (await agentAs('supervisor')).agent;
    second = (await agentAs('supervisor')).agent;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('serves a sensible DEFAULT before anybody configures anything (FR-041)', async () => {
    const response = await first.get('/api/reports/dashboard/arrangement');

    expect(response.status).toBe(200);

    // An empty dashboard on first visit is indistinguishable from a broken one,
    // and the person it happens to has no idea what to add.
    expect(response.body.layout.length).toBeGreaterThan(0);
    expect(response.body.layout).toEqual([...DEFAULT_LAYOUT]);
  });

  it('persists an arrangement across requests', async () => {
    const layout = ['volume.byCategory', 'volume.received'];

    const saved = await first.put('/api/reports/dashboard/arrangement').send({ layout });

    expect(saved.status).toBe(200);
    expect(saved.body.layout).toEqual(layout);

    // Read back in a separate request, so this tests the row rather than the
    // response the write happened to echo.
    const read = await first.get('/api/reports/dashboard/arrangement');

    expect(read.body.layout).toEqual(layout);
  });

  it('belongs to ONE user — a second supervisor sees their own', async () => {
    await first.put('/api/reports/dashboard/arrangement').send({
      layout: ['volume.byCategory'],
    });

    await second.put('/api/reports/dashboard/arrangement').send({
      layout: ['volume.byChannel', 'volume.overTime'],
    });

    const one = await first.get('/api/reports/dashboard/arrangement');
    const two = await second.get('/api/reports/dashboard/arrangement');

    expect(one.body.layout).toEqual(['volume.byCategory']);
    expect(two.body.layout).toEqual(['volume.byChannel', 'volume.overTime']);

    // The assertion that would catch a shared row, which is the failure a
    // `UNIQUE(user_id)` index alone does not prevent — it prevents two rows for
    // one user, not one row read by two.
    expect(one.body.layout).not.toEqual(two.body.layout);
  });

  it('replaces rather than appending, so a layout can be shortened', async () => {
    await first.put('/api/reports/dashboard/arrangement').send({
      layout: ['volume.received', 'volume.openAtEnd', 'volume.overTime'],
    });

    await first.put('/api/reports/dashboard/arrangement').send({
      layout: ['volume.received'],
    });

    const read = await first.get('/api/reports/dashboard/arrangement');

    // An append-only layout is one a user can never tidy: they remove a tile,
    // it comes back, and the only remaining action is to stop using the feature.
    expect(read.body.layout).toEqual(['volume.received']);
  });

  it('removes a duplicated key rather than storing it twice', async () => {
    const saved = await first.put('/api/reports/dashboard/arrangement').send({
      layout: ['volume.received', 'volume.received', 'volume.overTime'],
    });

    // The same tile twice is a client slip, not a request needing an answer —
    // the intent is unambiguous, so it is honoured rather than refused.
    expect(saved.status).toBe(200);
    expect(saved.body.layout).toEqual(['volume.received', 'volume.overTime']);
  });

  it('travels with the dashboard, so the client needs no second request', async () => {
    await first.put('/api/reports/dashboard/arrangement').send({
      layout: ['volume.overTime', 'volume.received'],
    });

    const dashboard = await first.get(`/api/reports/dashboard?${PERIOD}`);

    expect(dashboard.status).toBe(200);

    // A layout fetched separately could be resolved against a different period
    // from the figures it lays out — the exact class of disagreement FR-002
    // exists to prevent.
    expect(dashboard.body.layout).toEqual(['volume.overTime', 'volume.received']);
  });
});
