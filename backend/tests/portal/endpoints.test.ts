import { describe, expect, it } from 'vitest';

import portalRouter from '../../src/routes/portal/index.js';
import { PORTAL_ENDPOINTS, PORTAL_MOUNT } from '../../src/portal/endpoints.js';

/**
 * THE RECONCILIATION (Phase 8, FR-018, T129).
 *
 * `portal/endpoints.ts` declares the portal surface, and the realm and scope
 * matrices iterate that declaration. Which means the declaration is only as good
 * as its agreement with the router: a route mounted without a declaration is
 * INVISIBLE to both matrices, and would sail past the two tests this phase
 * cannot ship without.
 *
 * So this file compares the two, in both directions, and it is deliberately the
 * shortest test in the phase. It needs no database and no fixture — it reads the
 * router's own stack.
 */

interface LayerRoute {
  path: string;
  methods: Record<string, boolean>;
}

interface Layer {
  route?: LayerRoute;
}

/** Express keeps its routes on the router's stack; this is the only place we read it. */
function mountedRoutes(): Array<{ method: string; path: string }> {
  const stack = (portalRouter as unknown as { stack: Layer[] }).stack ?? [];
  const routes: Array<{ method: string; path: string }> = [];

  for (const layer of stack) {
    if (!layer.route) continue;

    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (!enabled || method === '_all') continue;
      routes.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }

  return routes;
}

function key(entry: { method: string; path: string }): string {
  return `${entry.method} ${entry.path}`;
}

describe('the declared portal surface matches the mounted one', () => {
  const mounted = mountedRoutes();
  const declared = PORTAL_ENDPOINTS.map((endpoint) => ({
    method: endpoint.method,
    path: endpoint.path,
  }));

  it('finds routes on the router at all', () => {
    // A guard against this whole file passing vacuously if Express changes how it
    // exposes its stack. An enumerated test that finds nothing to enumerate is
    // the most dangerous kind of green.
    expect(mounted.length).toBeGreaterThan(10);
  });

  it('declares every mounted route', () => {
    const declaredKeys = new Set(declared.map(key));
    const undeclared = mounted.filter((route) => !declaredKeys.has(key(route)));

    // A route here and not in the declaration is a route the realm and scope
    // matrices never test. That is the failure this file exists to catch.
    expect(undeclared.map(key)).toEqual([]);
  });

  it('mounts every declared route', () => {
    const mountedKeys = new Set(mounted.map(key));
    const unmounted = declared.filter((route) => !mountedKeys.has(key(route)));

    // The other direction matters less but still matters: a declaration with no
    // route makes the matrices assert things about an endpoint that does not
    // exist, which is a test passing for the wrong reason.
    expect(unmounted.map(key)).toEqual([]);
  });

  it('mounts under one prefix, in one file', () => {
    expect(PORTAL_MOUNT).toBe('/api/portal');
  });

  it('declares no route that takes a customer or contact id (FR-015)', () => {
    // The strongest form of "a supplied identifier is ignored" is that there is
    // no parameter for it to occupy.
    for (const endpoint of PORTAL_ENDPOINTS) {
      expect(endpoint.path).not.toMatch(/:customerId/);
      expect(endpoint.path).not.toMatch(/:contactId/);
      expect(endpoint.path).not.toMatch(/:ticketId/);
      expect(endpoint.path).not.toMatch(/:id\b/);
    }
  });

  it('names a rate-limit scope on every endpoint (FR-010, SC-022)', () => {
    for (const endpoint of PORTAL_ENDPOINTS) {
      expect(endpoint.rateLimit).toMatch(/^portal-/);
    }
  });

  it('keeps reading and writing on separate scopes (FR-025, FR-045)', () => {
    const scopeOf = (method: string, path: string) =>
      PORTAL_ENDPOINTS.find((e) => e.method === method && e.path === path)?.rateLimit;

    // A flood of submissions must not stop a customer reading, and a flood of
    // searches must not either.
    expect(scopeOf('GET', '/tickets')).not.toBe(scopeOf('POST', '/tickets'));
    expect(scopeOf('GET', '/kb/search')).not.toBe(scopeOf('GET', '/kb/articles/:slug'));
    expect(scopeOf('POST', '/tickets/:reference/replies')).not.toBe(scopeOf('GET', '/tickets'));
  });

  it('marks exactly the authentication and invitation routes as session-free', () => {
    const sessionFree = PORTAL_ENDPOINTS.filter((endpoint) => endpoint.session === 'none').map(
      (endpoint) => endpoint.path,
    );

    // Seven, all of them either how a session begins, ends, and is recovered, or
    // how an invitation is accepted. None of them reads a customer's records.
    expect(sessionFree.sort()).toEqual([
      '/auth/forgot-password',
      '/auth/login',
      '/auth/logout',
      '/auth/refresh',
      '/auth/reset-password',
      '/invitations/:token',
      '/invitations/:token/accept',
    ]);
  });
});
