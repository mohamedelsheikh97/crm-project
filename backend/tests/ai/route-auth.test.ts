import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { closeTestDatabase, setupTestDatabase } from '../helpers/database.js';

/**
 * EVERY STAFF AI ROUTE REQUIRES AUTHENTICATION (Constitution Principle II).
 *
 * THIS TEST EXISTS BECAUSE THE FIRST VERSION OF `routes/ai/index.ts` DID NOT
 * APPLY `authenticate`, and nothing in the suite noticed.
 *
 * The near-miss is worth recording, because it explains why a test that looks
 * this obvious is worth having. The permissioned routes were fine by accident:
 * `requirePermission` refuses when `req.user` is absent, so summary, draft and
 * the proposal endpoints all failed closed with a 401. But `GET /ai/features`
 * carries NO permission gate — deliberately, because it refuses nothing and a
 * key every role holds is noise (research D12) — and it was therefore reachable
 * by anyone on the internet. A read-only leak of which AI features are enabled,
 * which is minor; a public endpoint nobody intended, which is not.
 *
 * It was found by curling the running application, not by the test suite. Phase
 * 8 built exactly this kind of enumeration for its portal surface
 * (`portal/endpoints.ts` plus two generated matrices) and it is what caught
 * nothing here, because the staff side has no equivalent list. This file is the
 * narrow version of that property for the routes this phase adds.
 *
 * ANY ROUTE ADDED TO `routes/ai/index.ts` MUST BE ADDED HERE.
 */
const AI_ROUTES: ReadonlyArray<{ method: 'get' | 'post'; path: string }> = [
  { method: 'get', path: '/api/ai/features' },
  { method: 'get', path: '/api/tickets/1/ai/summary' },
  { method: 'post', path: '/api/tickets/1/ai/draft' },
  { method: 'get', path: '/api/tickets/1/similar' },
  { method: 'get', path: '/api/tickets/1/ai/category-proposal' },
  { method: 'post', path: '/api/tickets/1/ai/category-proposal/accept' },
  { method: 'post', path: '/api/tickets/1/ai/category-proposal/dismiss' },
];

describe('staff AI routes are unreachable without authentication', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it.each(AI_ROUTES)(
    '$method $path refuses an unauthenticated caller',
    async ({ method, path }) => {
      const response = await request(app)[method](path);

      // 401, not 403 and not 200. A 403 would mean the request was authenticated
      // and merely unauthorised, which it was not.
      expect(response.status).toBe(401);
    },
  );

  it('reconciles this list against the mounted ticket AI router', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');

    // The ticket-scoped routes. `routes/ai/index.ts` holds only `/features`,
    // which is covered above — the two were split after a bare mount of the
    // combined router put Phase 7's public surface behind authentication.
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../src/routes/tickets/ai.routes.ts'),
      'utf8',
    );

    // Every `router.get('...')` / `router.post('...')` in the router must appear
    // above, so a route added without a test fails here rather than shipping
    // ungated. This is the reconciliation Phase 8's T129 does for the portal.
    const mounted = [...source.matchAll(/router\.(get|post)\(\s*'([^']+)'/g)].map(
      (match) => `${match[1]} ${match[2]}`,
    );

    // The ticket AI router declares paths relative to `/tickets`, so strip that
    // prefix from the covered list before comparing.
    const covered = AI_ROUTES.filter((route) => route.path.startsWith('/api/tickets/')).map(
      (route) =>
        `${route.method} ${route.path.replace('/api/tickets', '').replace('/1/', '/:id/')}`,
    );

    for (const route of mounted) {
      expect(
        covered.includes(route),
        `${route} is mounted in routes/tickets/ai.routes.ts but not covered by this test`,
      ).toBe(true);
    }

    // And the reverse, so a route removed from the router does not leave a
    // stale entry here quietly passing.
    expect(mounted.length).toBe(covered.length);
  });
});
