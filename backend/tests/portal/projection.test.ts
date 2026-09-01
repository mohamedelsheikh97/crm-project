import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { Task, TicketNote, TicketSla, Ticket, TicketSatisfaction } from '../../src/models/index.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { createTestUser } from '../helpers/auth.js';

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
 * THE FROZEN KEY SET (Phase 8, FR-030, FR-031, SC-008, research.md D14).
 *
 * What a customer may see, asserted by EQUALITY rather than containment. That
 * distinction is the whole test: a containment assertion passes forever while
 * fields accumulate, and the field that leaks will be added by somebody
 * improving an internal screen who never opens this file.
 *
 * Phase 5 built the property this rests on, and said so in `timeline.service.ts`:
 * the timeline reads `messages` and nothing else, so "the structure Phase 8 will
 * build a customer-facing view on contains nothing internal to leak. A later
 * phase that adds notes or history here destroys that property, AND IT WILL NOT
 * BE OBVIOUS THAT IT HAS." This file is the guard against the last clause.
 *
 * The fixture carries every excluded thing on purpose. A projection test run
 * against a bare ticket proves nothing — of course it did not leak the note that
 * does not exist.
 */

const TICKET_KEYS = [
  'reference',
  'subject',
  'description',
  'state',
  'isSettled',
  'raisedAt',
  'lastChangedAt',
  'category',
  'priority',
  'ratingOffered',
  'replyOffered',
  'satisfaction',
  'messages',
];

const MESSAGE_KEYS = ['direction', 'channel', 'occurredAt', 'body', 'attachments'];

/**
 * Field names that must never appear ANYWHERE in the response, at any depth.
 *
 * A second, blunter net beneath the key-set assertion. The key set catches a new
 * top-level field; this catches one buried inside a nested object somebody added
 * — which the key comparison would not see.
 */
const FORBIDDEN_SUBSTRINGS = [
  'assignee',
  'note',
  'task',
  'mention',
  'sla',
  'automation',
  'merged',
  'provisional',
  'escalat',
  'history',
  'author',
  'deliveryState',
  'internal',
  'customerId',
  'contactId',
  'ticketId',
  'userId',
];

describe('the customer ticket view is exactly what it is declared to be', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
    await addMessages(world.ticketA.id);

    // EVERYTHING A CUSTOMER MUST NOT SEE, attached to the very ticket they are
    // about to open. Without these the test would be asserting the absence of
    // things that were never there.
    const agent = await createTestUser({ roleKey: 'agent' });

    await Ticket.update(
      {
        assignee_user_id: agent.id,
        escalation_reason: 'Customer threatened to escalate to the regulator',
      },
      { where: { id: world.ticketA.id } },
    );

    await TicketNote.create({
      ticket_id: world.ticketA.id,
      author_user_id: agent.id,
      body: 'INTERNAL: this customer is disputing the invoice, do not offer a refund yet.',
    });

    await Task.create({
      title: 'Chase the supplier before replying',
      ticket_id: world.ticketA.id,
      customer_id: null,
      owner_user_id: agent.id,
      due_at: null,
      remind_at: null,
      completed_at: null,
      created_by_user_id: agent.id,
    });

    // A BREACHED SLA on the ticket the customer is about to open. Phase 6 said
    // in writing that customers would never see SLA state; this is the fixture
    // that proves the promise held.
    await TicketSla.create({
      ticket_id: world.ticketA.id,
      policy_id: null,
      started_at: new Date(Date.now() - 7_200_000),
      response_target_at: new Date(Date.now() - 3_600_000),
      resolution_target_at: new Date(Date.now() - 1_800_000),
      response_breached_at: new Date(Date.now() - 3_000_000),
    });
  });

  it('returns exactly the declared keys — no more, no fewer', async () => {
    const response = await supertest(app)
      .get(`/api/portal/tickets/${world.ticketA.reference}`)
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(response.status).toBe(200);
    // EQUALITY. See the header: containment would let fields accumulate.
    expect(Object.keys(response.body).sort()).toEqual([...TICKET_KEYS].sort());
  });

  it('returns exactly the declared keys on every message', async () => {
    const response = await supertest(app)
      .get(`/api/portal/tickets/${world.ticketA.reference}`)
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(response.body.messages.length).toBeGreaterThan(0);

    for (const message of response.body.messages) {
      expect(Object.keys(message).sort()).toEqual([...MESSAGE_KEYS].sort());
    }
  });

  it('contains no internal note, task, assignee, SLA state, or escalation reason', async () => {
    const response = await supertest(app)
      .get(`/api/portal/tickets/${world.ticketA.reference}`)
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    const serialised = JSON.stringify(response.body);

    // The note's own words, not just its field name: the strongest form of this
    // assertion is that the sentence an agent wrote about the customer is
    // nowhere in what the customer receives.
    expect(serialised).not.toContain('do not offer a refund');
    expect(serialised).not.toContain('Chase the supplier');
    expect(serialised).not.toContain('regulator');

    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('shows a customer state, never the internal status string', async () => {
    await Ticket.update({ status: 'escalated' }, { where: { id: world.ticketA.id } });

    const response = await supertest(app)
      .get(`/api/portal/tickets/${world.ticketA.reference}`)
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    // `escalated` collapses into `in_progress` deliberately (FR-028): the
    // difference is the organisation's internal posture, and a customer who can
    // see it will ask "escalated to whom?".
    expect(response.body.state).toBe('in_progress');
    expect(JSON.stringify(response.body)).not.toContain('escalated');
  });

  it('never exposes an internal id — the reference is the only handle (FR-065)', async () => {
    const response = await supertest(app)
      .get(`/api/portal/tickets/${world.ticketA.reference}`)
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(response.body.reference).toBe(world.ticketA.reference);
    expect(response.body).not.toHaveProperty('id');
    // The ticket's numeric id must not appear as a value anywhere either. An
    // attachment id is the one number a customer legitimately holds, and it is
    // scoped through the ticket rather than being a handle on its own.
    expect(response.body).not.toHaveProperty('ticketId');
  });

  it('includes a submitted rating, and the key set grows only deliberately', async () => {
    await Ticket.update({ status: 'resolved' }, { where: { id: world.ticketA.id } });

    await TicketSatisfaction.create({
      ticket_id: world.ticketA.id,
      score: 4,
      comment: 'Sorted in the end.',
      submitted_by_contact_id: world.a.contactId,
      submitted_at: new Date(),
    });

    const response = await supertest(app)
      .get(`/api/portal/tickets/${world.ticketA.reference}`)
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(Object.keys(response.body).sort()).toEqual([...TICKET_KEYS].sort());
    expect(response.body.satisfaction).toEqual({
      score: 4,
      comment: 'Sorted in the end.',
      submittedAt: expect.any(String),
    });
    // The rating's own keys are frozen too — `submittedByContactId` would be an
    // id in a customer-facing payload.
    expect(Object.keys(response.body.satisfaction).sort()).toEqual([
      'comment',
      'score',
      'submittedAt',
    ]);
  });
});
