import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { closeTestDatabase, setupTestDatabase } from '../helpers/database.js';

/**
 * Every reporting route is gated, and NOTHING ELSE BECAME GATED (Phase 10).
 *
 * The second half is the point, and it is here because of a defect Phase 9
 * actually shipped: its AI router was mounted bare, so the `authenticate` it
 * applied leaked onto every route registered after it and put Phase 7's PUBLIC
 * knowledge base behind a token. The permissioned routes were fine by accident;
 * the one route with no permission gate was reachable by anyone.
 *
 * It was found by curling the running application, not by the suite. So this
 * file checks BOTH directions — the routes this phase added, and the surfaces it
 * did not touch.
 *
 * ANY ROUTE ADDED TO `routes/reports/index.ts` MUST BE ADDED HERE.
 */
const REPORT_ROUTES: ReadonlyArray<{ method: 'get' | 'post' | 'put'; path: string }> = [
  { method: 'get', path: '/api/reports/dashboard?from=2026-02-01&to=2026-02-28' },
  { method: 'get', path: '/api/reports/dashboard/arrangement' },
  { method: 'put', path: '/api/reports/dashboard/arrangement' },
  { method: 'get', path: '/api/reports/volume?from=2026-02-01&to=2026-02-28' },
  { method: 'get', path: '/api/reports/sla?from=2026-02-01&to=2026-02-28' },
  { method: 'get', path: '/api/reports/csat?from=2026-02-01&to=2026-02-28' },
  { method: 'get', path: '/api/reports/agents?from=2026-02-01&to=2026-02-28' },
  // The literal ':report' is deliberate — it is what the reconciliation below
  // reads out of the router, and Express matches it as any other segment, so
  // the 401 assertion is still a real request through the real middleware.
  { method: 'post', path: '/api/reports/:report/export' },
  { method: 'post', path: '/api/reports/:report/print' },
];

describe('reporting routes are unreachable without authentication', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it.each(REPORT_ROUTES)(
    '$method $path refuses an unauthenticated caller',
    async ({ method, path }) => {
      const response = await request(app)[method](path);

      // 401, not 403 and not 200. A 403 would mean the caller was authenticated
      // and merely unauthorised, which they were not.
      expect(response.status).toBe(401);
    },
  );

  it('reconciles this list against the mounted router', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');

    const source = await readFile(
      path.resolve(import.meta.dirname, '../../src/routes/reports/index.ts'),
      'utf8',
    );

    const mounted = [...source.matchAll(/router\.(get|post|put)\(\s*'([^']+)'/g)].map(
      (match) => `${match[1]} ${match[2]}`,
    );

    const covered = REPORT_ROUTES.map(
      (route) => `${route.method} ${route.path.replace('/api/reports', '').split('?')[0]}`,
    );

    for (const route of mounted) {
      expect(
        covered.includes(route),
        `${route} is mounted in routes/reports/index.ts but not covered by this test`,
      ).toBe(true);
    }

    // The reverse too, so a route removed from the router does not leave a
    // stale entry here quietly passing.
    expect(mounted.length).toBe(covered.length);
  });

  describe('the surfaces this phase did not touch', () => {
    it('leaves the PUBLIC knowledge base anonymous (the Phase 9 regression)', async () => {
      const response = await request(app).get('/api/public/kb/categories');

      // Mounting a router that applies `authenticate` must not gate anything
      // registered after it. This is the assertion that would have caught the
      // Phase 9 defect on the day it was written.
      expect(response.status).toBe(200);
    });

    it('leaves the public form surface anonymous', async () => {
      const response = await request(app).get('/api/public/forms/does-not-exist');

      // 404 for an unknown slug, NOT 401 — reachable without a token.
      expect(response.status).not.toBe(401);
    });

    it('leaves health anonymous', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
    });

    it('leaves the staff ticket surface refusing as it did before', async () => {
      const response = await request(app).get('/api/tickets');

      expect(response.status).toBe(401);
    });
  });
});
