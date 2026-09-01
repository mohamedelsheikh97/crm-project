import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { BusinessCalendar, SlaPolicy, Ticket, TicketSla } from '../../src/models/index.js';
import { PORTAL_ENDPOINTS, portalUrl } from '../../src/portal/endpoints.js';
import { parseReference } from '../../src/tickets/reference.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { buildPortalWorld, portalAgent, type PortalWorld } from './fixtures.js';

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
 * RAISING A REQUEST (Phase 8, User Story 2, FR-019 - FR-025, SC-005).
 *
 * Two claims, and the second is the one that needed the design work:
 *
 *   1. A customer can raise a request.
 *   2. WHAT THEY RAISE IS AN ORDINARY TICKET. Not a parallel type, not a
 *      lightweight record an agent has to convert. It appears in the queue, it
 *      acquires SLA targets, and it is assignable — because it is created through
 *      `ticket.service.create`, the same function the staff form uses.
 */

describe('a customer raises a request', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  it('creates a ticket owned by the session, not by the request (FR-015, FR-026b)', async () => {
    const response = await portalAgent(world.a.accessToken).post('/api/portal/tickets').send({
      subject: 'The card reader is offline',
      description: 'It shows a red light and will not read anything.',
      // EVERY WAY A CLIENT MIGHT TRY TO RAISE A TICKET AS SOMEBODY ELSE.
      customerId: world.otherCustomerId,
      requestingContactId: world.b.contactId,
      contactId: world.b.contactId,
    });

    expect(response.status).toBe(201);

    const id = parseReference(response.body.reference as string);
    const ticket = await Ticket.findByPk(id as number);

    expect(ticket?.customer_id).toBe(world.customerId);
    expect(ticket?.requesting_contact_id).toBe(world.a.contactId);
  });

  it('records the portal as its source, and nobody as its creator (FR-021)', async () => {
    const response = await portalAgent(world.a.accessToken)
      .post('/api/portal/tickets')
      .send({ subject: 'Question about my invoice', description: 'The total looks wrong.' });

    const ticket = await Ticket.findByPk(
      parseReference(response.body.reference as string) as number,
    );

    expect(ticket?.source).toBe('portal');
    // Read together with the source: a null creator and a non-manual source is a
    // ticket nobody who works here typed (Phase 5's rule, inherited).
    expect(ticket?.created_by_user_id).toBeNull();
  });

  it('returns the reference and nothing else (FR-065)', async () => {
    const response = await portalAgent(world.a.accessToken)
      .post('/api/portal/tickets')
      .send({ subject: 'Subject', description: 'Description.' });

    expect(Object.keys(response.body)).toEqual(['reference']);
    expect(response.body.reference).toMatch(/^TKT-\d{6}$/);
  });

  it('refuses an out-of-range category rather than coercing it (FR-023)', async () => {
    const response = await portalAgent(world.a.accessToken).post('/api/portal/tickets').send({
      subject: 'Subject',
      description: 'Description.',
      category: 'not-a-category',
    });

    // REFUSED, not silently filed as "general". Quietly misfiling a billing
    // complaint is worse than asking again.
    expect(response.status).toBe(400);
    expect(await Ticket.count({ where: { subject: 'Subject' } })).toBe(0);
  });

  it('accepts a submission with no category or priority at all', async () => {
    // Optional for a customer, unlike the staff form: somebody should not have to
    // classify their own problem to be allowed to report it.
    const response = await portalAgent(world.a.accessToken)
      .post('/api/portal/tickets')
      .send({ subject: 'Something is wrong', description: 'I am not sure what.' });

    expect(response.status).toBe(201);
  });

  it('creates nothing when the submission is incomplete (FR-024)', async () => {
    const before = await Ticket.count();

    const response = await portalAgent(world.a.accessToken)
      .post('/api/portal/tickets')
      .send({ subject: '   ', description: '' });

    expect(response.status).toBe(400);
    // i18n KEYS, so the message reaches the customer in their own language.
    expect(response.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'description',
      'subject',
    ]);
    expect(await Ticket.count()).toBe(before);
  });
});

describe('a portal ticket is an ordinary ticket (FR-020, SC-005)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  it('appears in the agent queue and acquires SLA targets', async () => {
    const { agent } = await agentAs('admin');

    // A CALENDAR AND A CATCH-ALL POLICY, created by the test rather than assumed.
    //
    // The test helper seeds PERMISSIONS, not CONTENT — Phase 4 settled that rule
    // — so neither exists unless a test makes them. Without the policy, the
    // assertion below was checking Phase 6's FR-014 ("a ticket matching no policy
    // gets no row at all") while claiming to check FR-010; without the calendar,
    // a policy that matches has no working hours to count in and target
    // computation fails, taking the whole submission with it.
    await BusinessCalendar.create({
      name: 'Test calendar',
      time_zone: 'Africa/Cairo',
      // Sun-Thu, 09:00-17:00 — the same shape the default seeder ships.
      working_days: 31,
      day_start_minute: 540,
      day_end_minute: 1020,
      is_active: true,
      updated_by_user_id: null,
    });

    await SlaPolicy.create({
      name: 'Catch-all for the portal test',
      category: null,
      priority: null,
      response_minutes: 60,
      resolution_minutes: 480,
      is_active: true,
      created_by_user_id: null,
    });

    const created = await portalAgent(world.a.accessToken)
      .post('/api/portal/tickets')
      .send({ subject: 'Raised from the portal', description: 'Please help.' });

    const id = parseReference(created.body.reference as string) as number;

    const queue = await agent.get('/api/tickets');
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((item: { id: number }) => item.id)).toContain(id);

    const detail = await agent.get(`/api/tickets/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('new');
    // FR-026i: the agent can see who will be able to read it in the portal.
    expect(detail.body.requestingContact?.email).toBe(world.a.email);

    // Phase 6's targets attach in the creating transaction (FR-010). A portal
    // ticket with no clock on it would be the tickets nobody is watching all
    // over again.
    expect(await TicketSla.findByPk(id)).not.toBeNull();
  });

  it('is transitionable and assignable like any other', async () => {
    const { agent } = await agentAs('admin');

    const created = await portalAgent(world.a.accessToken)
      .post('/api/portal/tickets')
      .send({ subject: 'Raised from the portal', description: 'Please help.' });

    const id = parseReference(created.body.reference as string) as number;

    // `version` IS REQUIRED by Phase 3's optimistic locking (`assertVersion`).
    // Omitting it answers 409, which is the ticket service working rather than a
    // portal ticket being special.
    const before = await agent.get(`/api/tickets/${id}`);

    const moved = await agent
      .post(`/api/tickets/${id}/transitions`)
      .send({ to: 'open', version: before.body.version });

    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('open');
  });
});

describe('the portal accepts no files, anywhere (FR-022, SC-030)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  /**
   * ENUMERATED over every write endpoint, because "we never wrote an upload
   * handler" is not the same promise as "this surface rejects files". Phase 2
   * deferred virus scanning with an explicit instruction to revisit it before
   * this phase, and Clarifications Q3 answers by declining the capability — so
   * the decline has to be observable.
   */
  const writes = PORTAL_ENDPOINTS.filter(
    (endpoint) => endpoint.method === 'POST' && endpoint.session === 'required',
  );

  for (const endpoint of writes) {
    it(`${endpoint.method} ${endpoint.path} refuses a multipart body`, async () => {
      const url = portalUrl(endpoint).replace(':reference', world.ticketA.reference);

      const response = await supertest(app)
        .post(url)
        .set('Authorization', `Bearer ${world.a.accessToken}`)
        .field('subject', 'Subject')
        .attach('file', Buffer.from('not really a file'), 'note.txt');

      // 400 with a named field, not a silently ignored part: a client that tries
      // gets an answer rather than a confusing complaint about a missing subject.
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('attachments');
    });
  }

  it('the refusal explains the alternative rather than just refusing', async () => {
    const response = await supertest(app)
      .post('/api/portal/tickets')
      .set('Authorization', `Bearer ${world.a.accessToken}`)
      .attach('file', Buffer.from('x'), 'note.txt');

    expect(response.body.error.details[0].message.toLowerCase()).toContain('email');
  });
});
