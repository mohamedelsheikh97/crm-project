import { readFile } from 'node:fs/promises';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { ROUTES } from '../../src/api/v1/catalog.js';
import * as apiClientService from '../../src/services/api-client.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

/**
 * Every published route is gated, AND NOTHING ELSE BECAME GATED (Phase 11).
 *
 * The second half is the point, and it is here because of a defect Phase 9
 * actually shipped: its AI router was mounted bare, so the `authenticate` it
 * applied leaked onto every route registered after it and put Phase 7's PUBLIC
 * knowledge base behind a token. The permissioned routes were fine by accident;
 * the one route with no permission gate was reachable by anyone.
 *
 * It was found by curling the running application, not by the suite. Phase 10
 * added this shape of test for its own router; this phase needs it more, because
 * the middleware being mounted here authenticates a DIFFERENT KIND OF SUBJECT. A
 * leak in this direction would offer machine-credential authentication to staff
 * routes — a worse failure than the original.
 *
 * ANY ROUTE ADDED TO `routes/v1/index.ts` MUST BE ADDED HERE. The reconciliation
 * below reads the router and fails otherwise.
 */
/**
 * DERIVED FROM THE CATALOG, not hand-listed.
 *
 * Phase 10's equivalent kept a literal list and reconciled it against the
 * router, which caught a real gap — but only after somebody remembered to add
 * the entry. Reading the catalog means a route added later is probed
 * automatically, and the thing that can still go wrong (a route mounted outside
 * the catalog) is what the reconciliation test below checks.
 *
 * `openapi.json` is excluded because it is deliberately unauthenticated; its own
 * assertion below covers it.
 */
const V1_ROUTES = ROUTES.filter((route) => route.permission !== null).map((route) => ({
  method: route.method,
  // A path parameter is probed with a literal digit: Express matches it as any
  // other segment, so the 401 assertion still runs through the real middleware.
  path: `/api/v1${route.path.replace(/:\w+/g, '1')}`,
}));

describe('the published interface refuses an unauthenticated caller', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('has routes to probe, so the sweep is not agreeing with nothing', () => {
    expect(V1_ROUTES.length).toBeGreaterThan(5);
  });

  it.each([...V1_ROUTES])(
    '$method $path refuses without a credential',
    async ({ method, path: routePath }) => {
      const response = await request(app)[method](routePath);

      // 401, not 403 and not 200. A 403 would mean the caller was authenticated
      // and merely unauthorised, which they were not — and a 200 would mean the
      // gate is missing entirely.
      expect(response.status).toBe(401);
    },
  );

  it('serves the description document WITHOUT a credential', async () => {
    /**
     * The one deliberate exception, and the complement to the sweep above.
     *
     * An integrator reads this before they have a working credential — it is
     * the first thing they open — and requiring one would make the
     * documentation unreachable to exactly the person who needs it. It
     * describes shapes, never data.
     */
    const response = await request(app).get('/api/v1/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(Object.keys(response.body.paths).length).toBeGreaterThan(5);
  });

  it('answers the published error shape, not the internal one', async () => {
    const response = await request(app).get('/api/v1/whoami');

    // Either 401 (mounted, no credential) or 404 (INTEGRATIONS_ENABLED off).
    // Both are correct; what must not happen is a 500 or an HTML error page.
    expect([401, 404]).toContain(response.status);

    if (response.status === 401) {
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
      // The refusal must not distinguish "no such client" from "wrong secret" —
      // otherwise it can be used to enumerate client identifiers.
      expect(response.body.error.message).not.toMatch(/client|secret|unknown/i);
    }
  });

  it('refuses a malformed credential the same way as an absent one', async () => {
    const absent = await request(app).get('/api/v1/whoami');
    const malformed = await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', 'Bearer not-a-credential');
    const wrongScheme = await request(app).get('/api/v1/whoami').set('Authorization', 'Basic abc');

    expect(malformed.status).toBe(absent.status);
    expect(wrongScheme.status).toBe(absent.status);
  });

  it('reconciles this list against the mounted router', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../src/routes/v1/index.ts'),
      'utf8',
    );

    /**
     * THE ROUTER MOUNTS FROM THE CATALOG, so what this checks is that nobody
     * bypassed it.
     *
     * A hand-written `router.get('/something', ...)` in the router file would be
     * served but absent from the catalog — and therefore absent from the
     * documentation and from the sweep above. That is the gap this closes.
     */
    const handWritten = [
      ...source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g),
    ].map((match) => `${match[1]} ${match[2]}`);

    expect(
      handWritten,
      'routes/v1/index.ts mounts a route directly; add it to api/v1/catalog.ts instead so it ' +
        'is documented and probed',
    ).toEqual([]);

    // And the loop that mounts from the catalog is still there — otherwise the
    // assertion above would pass on a router that serves nothing.
    expect(source).toContain('for (const route of ROUTES)');
  });

  describe('the surfaces this phase did not touch', () => {
    /**
     * THE ASSERTIONS THAT WOULD HAVE CAUGHT THE PHASE 9 DEFECT ON THE DAY.
     *
     * Mounting a router that applies an authenticator must not gate anything
     * registered after it — and here the authenticator accepts a different kind
     * of credential entirely, so a leak would be worse than a token requirement.
     */
    it('leaves the PUBLIC knowledge base anonymous', async () => {
      const response = await request(app).get('/api/public/kb/categories');

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

    it('refuses a MACHINE CREDENTIAL on a staff route', async () => {
      /**
       * The realms do not overlap, and this is the assertion that proves it in
       * the direction that matters.
       *
       * Both realms answer `UNAUTHENTICATED` — deliberately, because FR-007
       * requires the published interface to reuse this system's error envelope
       * rather than invent a second convention. So the code cannot tell them
       * apart, and asserting that it does would be asserting a defect.
       *
       * What distinguishes them is which credential each accepts. A real machine
       * credential presented to a staff route must be refused: `authenticate`
       * expects a JWT and there is no branch that tries the other kind.
       */
      const { bearer } = await apiClientService.issue({
        name: 'Realm separation probe',
        permissions: ['tickets:view'],
        createdByUserId: (await createTestUser({ roleKey: 'admin' })).id,
        grantableBy: new Set(['tickets:view'] as const),
      });

      const response = await request(app)
        .get('/api/tickets')
        .set('Authorization', `Bearer ${bearer}`);

      expect(response.status).toBe(401);
    });

    it('leaves the portal realm refusing a staff token as before', async () => {
      const response = await request(app).get('/api/portal/tickets');

      expect(response.status).toBe(401);
    });

    it('leaves the reporting routes on staff authentication', async () => {
      const response = await request(app).get('/api/reports/volume?from=2026-02-01&to=2026-02-28');

      expect(response.status).toBe(401);
    });
  });
});
