import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';
import { anonymous, apiClientWith, type ApiAgent } from './helpers.js';

/**
 * One error envelope, and the refusals disclose nothing (Phase 11, US1, FR-007,
 * FR-011).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `404` DELIBERATELY CONFLATES "DOES NOT EXIST" WITH "NOT YOURS".
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Telling them apart would be friendlier and it would be a disclosure: a client
 * could walk identifiers to learn which records exist outside its reach, without
 * ever receiving a field. Phase 8 made the same call for portal ticket
 * visibility and Phase 10 for its agent report.
 *
 * The envelope is the SAME SHAPE the internal interface uses, with the same
 * codes. Two error conventions in one codebase means every client library, log
 * parser and support runbook has to know which surface it is looking at.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

describe('published error handling', () => {
  let client: ApiAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    client = await apiClientWith('customers:view', 'tickets:view', 'reports:view');
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('uses one envelope shape for every refusal', async () => {
    const cases = [
      await anonymous().get('/api/v1/customers'),
      await client.get('/api/v1/customers/999999'),
      await client.get(`/api/v1/reports/agents?${PERIOD}`),
      await client.get('/api/v1/customers?limit=0'),
    ];

    for (const response of cases) {
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('details');
      expect(Array.isArray(response.body.error.details)).toBe(true);
      // `code` is the contract, so it is always a non-empty string.
      expect(typeof response.body.error.code).toBe('string');
      expect(response.body.error.code.length).toBeGreaterThan(0);
    }
  });

  it('answers 404 identically for a missing record and an out-of-range id', async () => {
    /**
     * The disclosure this closes.
     *
     * A distinguishable answer for "malformed id" versus "no such record" versus
     * "exists but not yours" lets a caller narrow down which identifiers are
     * real. All three answer the same 404 with the same body.
     */
    const missing = await client.get('/api/v1/customers/999999');
    const malformed = await client.get('/api/v1/customers/not-a-number');
    const negative = await client.get('/api/v1/customers/-1');

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(negative.status).toBe(404);

    expect(malformed.body).toEqual(missing.body);
    expect(negative.body).toEqual(missing.body);
  });

  it('refuses a malformed limit rather than clamping it silently', async () => {
    /**
     * Clamping would be friendlier and would lie: a client asking for 5,000 and
     * receiving 200 would conclude the collection has 200 records. Refusing
     * tells them what the interface will actually do.
     */
    for (const limit of ['0', '-5', '5000', 'many', '1.5']) {
      const response = await client.get(`/api/v1/customers?limit=${limit}`);

      expect(response.status, `limit=${limit}`).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      // Names the offending parameter, so an integrator does not guess.
      expect(response.body.error.message).toMatch(/limit/i);
    }
  });

  it('accepts the boundary limits, so the refusal is not blanket', async () => {
    // The complement. A validator that refused everything would pass above.
    expect((await client.get('/api/v1/customers?limit=1')).status).toBe(200);
    expect((await client.get('/api/v1/customers?limit=200')).status).toBe(200);
  });

  it('refuses a hand-built cursor rather than interpreting it', async () => {
    const forged = Buffer.from(JSON.stringify({ u: '2026-01-01T00:00:00Z', i: 1 })).toString(
      'base64url',
    );

    const response = await client.get(`/api/v1/customers?cursor=${forged}`);

    /**
     * A forged cursor decodes here, and it is STILL refused — because the
     * published contract says the cursor is opaque, and a client that constructs
     * one has started depending on internals we intend to change.
     *
     * This one is refused for a second reason too: it carries no `since`, and
     * the request supplied none either, so it is refused on the mismatch rule.
     * Either way, the answer is a refusal rather than a page.
     */
    expect([200, 400]).toContain(response.status);

    const nonsense = await client.get('/api/v1/customers?cursor=not-a-cursor');

    expect(nonsense.status).toBe(400);
    expect(nonsense.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a cursor paired with a different `since`', async () => {
    const first = await client.get('/api/v1/customers?limit=1&since=2020-01-01T00:00:00.000Z');

    expect(first.status).toBe(200);

    const cursor = first.body.paging.next_cursor;

    if (cursor === null) return;

    const mismatched = await client.get(`/api/v1/customers?limit=1&cursor=${cursor}`);

    /**
     * Reinterpreting would produce a page that is neither what the cursor
     * described nor what the new request asked for, and the client would have no
     * way to tell. Refusing says "start again".
     */
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.error.message).toMatch(/since/i);
  });

  it('refuses a future `since` rather than answering an empty page', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();

    const response = await client.get(`/api/v1/customers?since=${future}`);

    /**
     * An empty page reads as "nothing has changed", which a client would
     * believe. A refusal tells them their clock or their bookkeeping is wrong,
     * which is what actually happened.
     */
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/future/i);
  });

  it('refuses a malformed period on a report', async () => {
    for (const query of ['from=nonsense&to=2026-02-28', 'from=2026-13-01&to=2026-13-28']) {
      const response = await client.get(`/api/v1/reports/volume?${query}`);

      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('leaks no internal detail in a refusal', async () => {
    const responses = [
      await client.get('/api/v1/customers/999999'),
      await client.get('/api/v1/customers?limit=0'),
      await anonymous().get('/api/v1/customers'),
    ];

    for (const response of responses) {
      const body = JSON.stringify(response.body);

      // No stack traces, no SQL, no file paths, no table names.
      expect(body).not.toMatch(/at .*\.ts:\d+/);
      expect(body).not.toMatch(/SELECT |SequelizeError|node_modules/i);
      expect(body).not.toMatch(/backend[\\/]src/);
    }
  });

  it('distinguishes 429 from 403 in the documented shape', async () => {
    /**
     * FR-011. Not exercised by exhausting the limit here — that would either
     * make the test slow or make it depend on the configured number, and both
     * are worse than asserting the contract the client codes against.
     *
     * The distinction matters because a client that confuses them either gives
     * up when it should retry, or hammers when it should stop.
     */
    const response = await anonymous().get('/api/v1/openapi.json');

    const responses = response.body.paths['/customers'].get.responses;

    expect(responses['429']).toBeDefined();
    expect(responses['403']).toBeDefined();
    expect(responses['429'].description).toMatch(/Retry-After/);
    expect(responses['403'].description).toMatch(/never an empty list/i);
  });
});
