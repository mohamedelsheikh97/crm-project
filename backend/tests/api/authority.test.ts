import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROUTES } from '../../src/api/v1/catalog.js';
import { PERMISSIONS } from '../../src/auth/permissions.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';
import { apiClientWith, type ApiAgent } from './helpers.js';

/**
 * A credential reaches exactly what it holds (Phase 11, US1, FR-016, SC-006).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REFUSAL IS A REFUSAL. NEVER AN EMPTY LIST.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The tempting implementation of "you may not see this" is to return nothing —
 * it never errors, and every client handles it. That is the failure US1
 * scenario 3 exists to prevent: an empty result reads as "there is no data", and
 * an integrator will build on it. They will conclude the organisation has no
 * customers, or that a report is empty this month, and nothing will ever tell
 * them otherwise.
 *
 * SC-006 asks for this over EVERY endpoint against a credential lacking EACH
 * authority in turn, so the sweep is generated from the catalog rather than
 * hand-listed — a route added later is covered without anybody remembering.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

/** The permissions the catalog actually gates on, deduplicated. */
const GATED = [
  ...new Set(
    ROUTES.map((route) => route.permission).filter(
      (permission): permission is Exclude<typeof permission, null | 'authenticated'> =>
        permission !== null && permission !== 'authenticated',
    ),
  ),
];

describe('published interface authority', () => {
  let full: ApiAgent;
  let none: ApiAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    full = await apiClientWith(...GATED);
    none = await apiClientWith();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  /** A catalog path with its parameters filled, plus a period where needed. */
  function pathFor(route: (typeof ROUTES)[number]): string {
    const filled = route.path.replace(/:\w+/g, '1');

    return `/api/v1${filled}${route.period ? `?${PERIOD}` : ''}`;
  }

  it('gates on keys that exist in the catalogue', () => {
    // A gate on a key nothing grants is a gate nobody can pass, and it would
    // look like a permission bug rather than a typo.
    const known = PERMISSIONS.map((permission) => permission.key);

    expect(GATED.length).toBeGreaterThan(2);

    for (const permission of GATED) {
      expect(known, `${permission} is gated on but not in the catalogue`).toContain(permission);
    }
  });

  it.each(
    ROUTES.filter((route) => route.permission !== null && route.permission !== 'authenticated'),
  )('refuses $path to a credential holding nothing', async (route) => {
    const response = await none.get(pathFor(route));

    /**
     * SC-006. A 403 or a 404 — never a 200 with an empty payload.
     *
     * Which of the two depends on the route: the agent report hides
     * (`onDenied: 'hide'`), everything else refuses openly.
     */
    const expected = route.onDenied === 'hide' ? 404 : 403;

    expect(response.status, `${route.path} answered ${response.status}`).toBe(expected);
    // And no data leaked into the refusal body.
    expect(response.body.data).toBeUndefined();
  });

  it('answers 403 with the permission NAMED, so an integrator can act', async () => {
    const response = await none.get(`/api/v1/reports/volume?${PERIOD}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    // The alternative to telling them is a support conversation.
    expect(response.body.error.message).toContain('reports:view');
    expect(
      response.body.error.details.some(
        (detail: { message: string }) => detail.message === 'reports:view',
      ),
    ).toBe(true);
  });

  it('does NOT substitute an empty list for a refusal', async () => {
    // The specific failure US1 scenario 3 names. Asserted separately from the
    // sweep because it is the one somebody would "fix" by making it friendlier.
    const response = await none.get('/api/v1/customers');

    expect(response.status).not.toBe(200);
    expect(response.body).not.toHaveProperty('data');
  });

  it('serves each route to a credential that DOES hold its key', async () => {
    /**
     * The complement, and it is what stops every assertion above passing
     * vacuously. A surface that refused everything would satisfy the whole
     * sweep.
     */
    for (const route of ROUTES) {
      if (route.permission === null) continue;

      const response = await full.get(pathFor(route));

      expect(
        [200, 404].includes(response.status),
        `${route.path} answered ${response.status} to a fully-authorised credential`,
      ).toBe(true);

      // 404 is only acceptable for a filled-in `:id` that does not exist — never
      // for a collection or a report.
      if (response.status === 404) {
        expect(route.path).toMatch(/:/);
      }
    }
  });

  it('hides the agent report rather than withholding it (FR-013)', async () => {
    const withoutAgents = await apiClientWith('reports:view');

    const response = await withoutAgents.get(`/api/v1/reports/agents?${PERIOD}`);

    /**
     * 404, and the distinction is the requirement rather than a preference.
     *
     * A 403 would tell the caller that per-agent figures exist and somebody else
     * can read them — which is what Phase 10's Clarifications Q1 decided not to
     * say. The report is ABSENT for this credential.
     */
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    // Nothing about the report's existence, its shape, or the rule it uses.
    expect(JSON.stringify(response.body)).not.toMatch(/agent|attribution/i);
  });

  it('reaches the agent report WITH the key, so the hiding is not blanket', async () => {
    const withAgents = await apiClientWith('reports:view_agents');

    const response = await withAgents.get(`/api/v1/reports/agents?${PERIOD}`);

    expect(response.status).toBe(200);
    // The attribution rule travels with the figures (Phase 10's FR-031): the
    // agent described cannot see them, so no client should render them without
    // the definition.
    expect(response.body.attribution_rule.key).toBe('current_assignee');
  });

  it('does not let one key stand in for another', async () => {
    // `customers:view` must not open tickets, and vice versa. The failure this
    // catches is a gate applied with the wrong constant — which reads correctly
    // and is wrong.
    const customersOnly = await apiClientWith('customers:view');

    expect((await customersOnly.get('/api/v1/customers')).status).toBe(200);
    expect((await customersOnly.get('/api/v1/tickets')).status).toBe(403);
  });
});
