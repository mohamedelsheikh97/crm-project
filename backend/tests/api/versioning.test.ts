import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROUTES } from '../../src/api/v1/catalog.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { anonymous, apiClientWith, type ApiAgent } from './helpers.js';

/**
 * Versioning (Phase 11, US1, FR-002, FR-003, FR-004, SC-002, SC-003).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONCE AN EXTERNAL SYSTEM READS A SHAPE, THE SHAPE IS A PROMISE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Until this phase, a shape could be corrected in the same commit that broke it.
 * Now it is a contract with somebody who cannot be redeployed on our schedule,
 * may not be reachable, and may not learn a change happened until their
 * integration fails at 3am. Versioning is the mechanism for changing our minds
 * later; without it, this phase makes every internal shape permanent by
 * accident.
 *
 * SC-002's "no request lacking a version is served" is the assertion that keeps
 * that mechanism real. If a missing version could be served the newest shape,
 * every client would break on OUR release schedule rather than their own.
 */
describe('interface versioning', () => {
  let client: ApiAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();

    client = await apiClientWith('customers:view', 'tickets:view');
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('stamps the version on EVERY response, including refusals', async () => {
    // SC-002. Redundant with the path by design: a response captured in a log
    // or pasted into a support ticket still says what produced it.
    const ok = await client.get('/api/v1/customers');
    const refused = await client.get('/api/v1/reports/volume?from=2026-02-01&to=2026-02-28');
    const missing = await client.get('/api/v1/customers/999999');

    expect(ok.headers['x-crm-api-version']).toBe('1');
    // A 403 and a 404 carry it too — those are the responses somebody is most
    // likely to be staring at when they need to know which version they called.
    expect(refused.headers['x-crm-api-version']).toBe('1');
    expect(missing.headers['x-crm-api-version']).toBe('1');
  });

  it('stamps it on the unauthenticated document as well', async () => {
    const response = await anonymous().get('/api/v1/openapi.json');

    expect(response.headers['x-crm-api-version']).toBe('1');
  });

  it('does not serve a version-less request the newest shape', async () => {
    /**
     * FR-002, and it is STRUCTURAL rather than a check.
     *
     * There is no code path that could interpret a missing version, because a
     * request without one does not reach a versioned handler at all — it lands
     * on the unversioned staff surface, which runs `authenticate` and refuses a
     * credential that is not a JWT.
     */
    const response = await anonymous()
      .get('/api/customers')
      .set('Authorization', `Bearer ${client.bearer}`);

    expect(response.status).toBe(401);
    // And it is definitely not a customer list.
    expect(response.body.data).toBeUndefined();
  });

  it('declares one version, and every route lives under it', () => {
    /**
     * SC-003's guarantee starts here: every route is in one catalog with one
     * version, so introducing a second means adding a version dimension
     * deliberately rather than discovering that two shapes are being served.
     */
    expect(ROUTES.length).toBeGreaterThan(5);

    for (const route of ROUTES) {
      // Relative to `/api/v1` — no route carries its own version segment, which
      // would be how two versions start diverging inside one router.
      expect(route.path.startsWith('/v')).toBe(false);
      expect(route.path.startsWith('/')).toBe(true);
    }
  });

  it('describes the version and the tolerance rule in the document', async () => {
    const response = await anonymous().get('/api/v1/openapi.json');

    expect(response.body.info.version).toBe('1');

    /**
     * SC-003 in the form a client can actually act on.
     *
     * "Clients MUST tolerate unknown fields" is the half of the versioning
     * contract that depends on THEM. A client that throws on an unrecognised
     * field has made every addition breaking, which defeats the whole scheme —
     * so the document says so rather than assuming they will guess.
     */
    expect(response.body.info.description).toMatch(/tolerate unknown fields/i);
    // And the stricter-than-usual rule about enum values, which exists because
    // this system has added ticket statuses before.
    expect(response.body.info.description).toMatch(/enumerated field IS breaking|enum/i);
  });

  it('serves the same shape twice for the same request', async () => {
    // A weak-looking assertion that catches a real class of bug: a response
    // assembled with a non-deterministic key set, which makes a client's schema
    // validation flaky rather than failing.
    const first = await client.get('/api/v1/customers?limit=1');
    const second = await client.get('/api/v1/customers?limit=1');

    expect(Object.keys(first.body).sort()).toEqual(Object.keys(second.body).sort());
    expect(Object.keys(first.body.paging).sort()).toEqual(['has_more', 'next_cursor']);
  });
});
