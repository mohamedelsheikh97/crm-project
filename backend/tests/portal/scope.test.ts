import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { PORTAL_ENDPOINTS, portalUrl } from '../../src/portal/endpoints.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { addMessages, buildPortalWorld, type PortalWorld } from './fixtures.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimit();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * THE SCOPE MATRIX (Phase 8, Clarifications Q2, FR-016, FR-017, FR-026f,
 * SC-003, SC-028, SC-029, research.md D5).
 *
 * The second of the two tests this phase cannot ship without. It answers one
 * question for every endpoint that names a resource: CAN A CUSTOMER REACH
 * SOMETHING THAT IS NOT THEIRS?
 *
 * Three ways to not be theirs, and all three are tested against every such
 * endpoint:
 *
 *   1. ANOTHER CUSTOMER'S ticket — the leak everybody thinks of.
 *   2. A COLLEAGUE'S ticket on the same customer record — the leak
 *      Clarifications Q2 exists to prevent, and the one a record-wide scope
 *      would allow while looking completely reasonable in review. On a company
 *      record this is a payroll query, a complaint, or a dispute.
 *   3. A ticket with NO requesting contact — the leak FR-026f prevents. This is
 *      the one that would appear silently, on the OLDEST data in the system, the
 *      first time somebody "helpfully" made a NULL association mean "visible to
 *      everyone on the record".
 *
 * ALL THREE MUST ANSWER EXACTLY AS A REFERENCE THAT NEVER EXISTED DOES. Not 403,
 * not a different code, not a different message. A distinguishable refusal
 * confirms the record exists — which, for case 2, confirms a colleague's
 * activity to somebody who works with them.
 */

type Method = 'get' | 'post' | 'patch' | 'delete';

const SCOPED = PORTAL_ENDPOINTS.filter((endpoint) => endpoint.targets !== undefined);

function urlFor(
  endpoint: (typeof PORTAL_ENDPOINTS)[number],
  reference: string,
  attachmentId = 999_999,
): string {
  return portalUrl(endpoint)
    .replace(':reference', reference)
    .replace(':attachmentId', String(attachmentId));
}

describe('portal scope: three ways to not be yours, one answer', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
    await addMessages(world.ticketA.id);
    await addMessages(world.ticketB.id);
  });

  it('has scoped endpoints to test', () => {
    expect(SCOPED.length).toBeGreaterThan(3);
  });

  /**
   * The baseline every other case is compared against. Captured from a live
   * request rather than hardcoded, so if the 404 shape ever changes the
   * comparison changes with it and the test keeps meaning what it says.
   */
  async function refusalBaseline(endpoint: (typeof PORTAL_ENDPOINTS)[number]) {
    const response = await supertest(app)
      [endpoint.method.toLowerCase() as Method](urlFor(endpoint, 'TKT-999999'))
      .set('Authorization', `Bearer ${world.a.accessToken}`)
      .send(endpoint.sampleBody ?? {});

    return { status: response.status, code: response.body.error?.code };
  }

  for (const endpoint of SCOPED) {
    describe(`${endpoint.method} ${endpoint.path}`, () => {
      it('refuses a reference that never existed', async () => {
        const baseline = await refusalBaseline(endpoint);

        expect(baseline.status).toBe(404);
        expect(baseline.code).toBe('NOT_FOUND');
      });

      it('refuses ANOTHER CUSTOMER’s ticket, identically', async () => {
        const baseline = await refusalBaseline(endpoint);

        const response = await supertest(app)
          [endpoint.method.toLowerCase() as Method](
            urlFor(endpoint, world.ticketOtherCustomer.reference),
          )
          .set('Authorization', `Bearer ${world.a.accessToken}`)
          .send(endpoint.sampleBody ?? {});

        expect(response.status).toBe(baseline.status);
        expect(response.body.error?.code).toBe(baseline.code);
      });

      it('refuses a COLLEAGUE’s ticket on the same customer record, identically', async () => {
        const baseline = await refusalBaseline(endpoint);

        const response = await supertest(app)
          [endpoint.method.toLowerCase() as Method](urlFor(endpoint, world.ticketB.reference))
          .set('Authorization', `Bearer ${world.a.accessToken}`)
          .send(endpoint.sampleBody ?? {});

        expect(response.status).toBe(baseline.status);
        expect(response.body.error?.code).toBe(baseline.code);
      });

      it('refuses a ticket with NO requesting contact, identically', async () => {
        const baseline = await refusalBaseline(endpoint);

        const response = await supertest(app)
          [endpoint.method.toLowerCase() as Method](
            urlFor(endpoint, world.ticketUnassociated.reference),
          )
          .set('Authorization', `Bearer ${world.a.accessToken}`)
          .send(endpoint.sampleBody ?? {});

        expect(response.status).toBe(baseline.status);
        expect(response.body.error?.code).toBe(baseline.code);
      });
    });
  }
});

describe('portal scope: the list shows exactly one contact’s requests', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  it('lists A’s ticket and nothing else', async () => {
    const response = await supertest(app)
      .get('/api/portal/tickets')
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(response.status).toBe(200);
    const references = response.body.items.map((item: { reference: string }) => item.reference);

    expect(references).toEqual([world.ticketA.reference]);
    // Stated as three separate assertions rather than one, so a failure names
    // WHICH of the three leaks happened.
    expect(references).not.toContain(world.ticketB.reference);
    expect(references).not.toContain(world.ticketUnassociated.reference);
    expect(references).not.toContain(world.ticketOtherCustomer.reference);
  });

  it('two colleagues on one company record see disjoint lists (SC-028)', async () => {
    const [forA, forB] = await Promise.all([
      supertest(app)
        .get('/api/portal/tickets')
        .set('Authorization', `Bearer ${world.a.accessToken}`),
      supertest(app)
        .get('/api/portal/tickets')
        .set('Authorization', `Bearer ${world.b.accessToken}`),
    ]);

    const refsA = forA.body.items.map((item: { reference: string }) => item.reference);
    const refsB = forB.body.items.map((item: { reference: string }) => item.reference);

    expect(refsA).toEqual([world.ticketA.reference]);
    expect(refsB).toEqual([world.ticketB.reference]);
    expect(refsA.filter((reference: string) => refsB.includes(reference))).toEqual([]);
  });

  it('an unassociated ticket is invisible to EVERY contact on the record (SC-029)', async () => {
    for (const contact of [world.a, world.b]) {
      const list = await supertest(app)
        .get('/api/portal/tickets')
        .set('Authorization', `Bearer ${contact.accessToken}`);

      const references = list.body.items.map((item: { reference: string }) => item.reference);
      expect(references).not.toContain(world.ticketUnassociated.reference);

      const direct = await supertest(app)
        .get(`/api/portal/tickets/${world.ticketUnassociated.reference}`)
        .set('Authorization', `Bearer ${contact.accessToken}`);

      expect(direct.status).toBe(404);
    }
  });

  it('the customer id in the session is not something a request can change (FR-015)', async () => {
    // Every plausible way a client might try to widen its own scope. All are
    // ignored rather than refused, because there is no parameter for them to
    // occupy — which is the strongest version of "ignored".
    const response = await supertest(app)
      .get('/api/portal/tickets')
      .query({
        customerId: world.otherCustomerId,
        contactId: world.b.contactId,
        requesting_contact_id: world.b.contactId,
      })
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { reference: string }) => item.reference)).toEqual([
      world.ticketA.reference,
    ]);
  });
});
