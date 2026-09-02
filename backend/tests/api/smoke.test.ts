import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import * as apiClientService from '../../src/services/api-client.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * The interface actually serves data (Phase 11, US1).
 *
 * Deliberately the first test written after mounting the router, because
 * everything else in this directory asserts what the interface REFUSES — and a
 * surface that refuses everything passes all of it. Phase 9 shipped a check that
 * passed vacuously for exactly this shape of reason.
 *
 * It reuses Phase 10's reporting fixture rather than building its own: the
 * fixture already contains the awkward cases (a merged pair, an unassigned
 * ticket, a ticket resolved outside the month, a rated ticket), and the
 * hand-computed answers in `fixture-answers.ts` are what the parity tests
 * compare against.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

describe('the published interface serves data', () => {
  let bearer: string;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    const admin = await createTestUser({ roleKey: 'admin' });

    const issued = await apiClientService.issue({
      name: 'Smoke client',
      permissions: ['customers:view', 'tickets:view', 'reports:view'],
      createdByUserId: admin.id,
      grantableBy: new Set(['customers:view', 'tickets:view', 'reports:view'] as const),
    });

    bearer = issued.bearer;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  function authed(path: string) {
    return request(app).get(path).set('Authorization', `Bearer ${bearer}`);
  }

  it('reports what the credential holds', async () => {
    const response = await authed('/api/v1/whoami');

    expect(response.status).toBe(200);
    expect(response.body.permissions).toEqual(['customers:view', 'reports:view', 'tickets:view']);
    expect(response.body.api_version).toBe('1');
  });

  it('stamps the version on every response', async () => {
    const response = await authed('/api/v1/customers');

    expect(response.headers['x-crm-api-version']).toBe('1');
  });

  it('lists customers in the published shape', async () => {
    const response = await authed('/api/v1/customers?limit=5');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);

    const [first] = response.body.data;

    // snake_case, and the fields the contract promises.
    expect(first).toHaveProperty('display_name');
    expect(first).toHaveProperty('is_provisional');
    expect(first).toHaveProperty('updated_at');
    // Not the internal shape.
    expect(first).not.toHaveProperty('displayName');
    // The normalised phone is this system's matching key, not a published field.
    expect(JSON.stringify(first)).not.toContain('normalised');

    expect(response.body.paging).toHaveProperty('has_more');
  });

  it('lists tickets, INCLUDING the merged one', async () => {
    const response = await authed('/api/v1/tickets?limit=50');

    expect(response.status).toBe(200);

    /**
     * The working list excludes merged tickets (Phase 3's FR-044 — "a queue full
     * of redirects is not a queue"). The published collection includes them, and
     * that difference is deliberate: a synchronising client must learn that a
     * ticket it holds was absorbed, and hiding the row would leave its copy open
     * forever.
     */
    const merged = response.body.data.filter(
      (ticket: { merged_into_ticket_id: number | null }) => ticket.merged_into_ticket_id !== null,
    );

    expect(merged.length).toBeGreaterThan(0);
    expect(response.body.data[0]).toHaveProperty('reference');
    expect(response.body.data[0].reference).toMatch(/^TKT-\d{6}$/);
  });

  it('returns a merged ticket WITH its pointer, not an error and not the survivor', async () => {
    const list = await authed('/api/v1/tickets?limit=50');
    const merged = list.body.data.find(
      (ticket: { merged_into_ticket_id: number | null }) => ticket.merged_into_ticket_id !== null,
    );

    expect(merged).toBeDefined();

    const response = await authed(`/api/v1/tickets/${merged.id}`);

    /**
     * 200 with the pointer — the same thing the screens show (FR-010).
     *
     * The two failure modes this rules out:
     *
     *   - returning the SURVIVOR'S row under the requested id, which would make
     *     a client count the same work twice with nothing to correct it;
     *   - a bare 404, which would leave them unable to follow the merge at all.
     *
     * The id in the response is the one that was asked for, and
     * `merged_into_ticket_id` names where the work went.
     */
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(merged.id);
    expect(response.body.merged_into_ticket_id).toBe(merged.merged_into_ticket_id);
    expect(response.body.merged_into_ticket_id).not.toBe(response.body.id);
  });

  it('serves a reporting figure with its whole envelope', async () => {
    const response = await authed(`/api/v1/reports/sla?${PERIOD}`);

    expect(response.status).toBe(200);

    const figure = response.body.responseCompliance;

    expect(figure).toBeDefined();
    // Every honesty field survives the trip (FR-012, SC-007).
    expect(figure).toHaveProperty('count');
    expect(figure).toHaveProperty('total');
    expect(figure).toHaveProperty('excluded');
    expect(figure).toHaveProperty('suppressed');
    expect(figure.period).toHaveProperty('time_zone');
    expect(figure.reflects_current_state).toBe(true);
  });

  it('refuses a report the credential does not hold, rather than emptying it', async () => {
    // The credential has `reports:view` but not `reports:view_agents`.
    const response = await authed(`/api/v1/reports/agents?${PERIOD}`);

    // 404, not 403: absent rather than present-and-withheld (FR-013).
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('attribution_rule');
  });

  it('describes itself, and the document lists what is mounted', async () => {
    const response = await request(app).get('/api/v1/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.paths['/customers']).toBeDefined();
    expect(response.body.paths['/tickets/{id}']).toBeDefined();
    expect(response.body.paths['/tickets/{id}'].get.responses['200'].description).toMatch(/MERGED/);
    expect(response.body.components.schemas.Figure).toBeDefined();
  });
});
