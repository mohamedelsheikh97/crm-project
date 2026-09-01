import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { Message, Ticket, TicketHistory } from '../../src/models/index.js';
import * as messageService from '../../src/services/message.service.js';
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
 * REPLYING, AND THE CLOSED BOUNDARY (Phase 8, User Story 5, FR-034 - FR-036,
 * SC-011, research.md D6, D9).
 *
 * Two decisions are under test here, and both were arrived at by reading existing
 * code rather than by preference:
 *
 * THE PORTAL IS A REPLYABLE CHANNEL (D6). `conversationFor` derives the reply path
 * from the last inbound message filtered to `REPLYABLE_CHANNELS`, so an
 * inbound-only portal would leave a portal-submitted ticket with NO REPLY PATH AT
 * ALL — the hole Phase 5 left for form submissions, inherited into the one phase
 * whose Definition of done requires a conversation. The last test in this file is
 * the one that proves it.
 *
 * FINALITY IS THE LIFECYCLE'S, NOT A TIME WINDOW (D9). `TRANSITIONS` makes
 * `closed -> open` need `tickets:reopen`, held only by a Supervisor, "because
 * closing finishes work and reopening undoes something already finished". So a
 * reply reopens a RESOLVED request and is refused on a CLOSED one — and refused
 * before anything is stored, because FR-036 forbids accepting a message and then
 * discarding it.
 */

describe('a customer replies on their own request', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  it('joins the same conversation and creates no second ticket (SC-011)', async () => {
    const before = await Ticket.count();

    const response = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/replies`)
      .send({ body: 'It is still not working.' });

    expect(response.status).toBe(201);
    expect(await Ticket.count()).toBe(before);

    const messages = await Message.findAll({ where: { ticket_id: world.ticketA.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.channel).toBe('portal');
    expect(messages[0]?.direction).toBe('inbound');
    // No staff author: a customer wrote it.
    expect(messages[0]?.author_user_id).toBeNull();
    expect(messages[0]?.sender_identity).toBe(world.a.email);
  });

  it('behaves like an inbound message on any other channel (FR-035)', async () => {
    await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/replies`)
      .send({ body: 'Any news?' });

    // The history event intake writes for every channel. Its presence is what
    // says the reply went through the shared path rather than a private one.
    const history = await TicketHistory.findAll({ where: { ticket_id: world.ticketA.id } });

    expect(history.map((entry) => entry.event)).toContain('ticket.message.received');
  });

  it('refuses an empty reply', async () => {
    const response = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/replies`)
      .send({ body: '   ' });

    expect(response.status).toBe(400);
    expect(await Message.count()).toBe(0);
  });

  it('cannot reply on a colleague’s request', async () => {
    const response = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketB.reference}/replies`)
      .send({ body: 'Let me in.' });

    expect(response.status).toBe(404);
    expect(await Message.count({ where: { ticket_id: world.ticketB.id } })).toBe(0);
  });
});

describe('the lifecycle boundary (research D9)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  it('a reply REOPENS a resolved request, with no actor', async () => {
    await Ticket.update({ status: 'resolved' }, { where: { id: world.ticketA.id } });

    const response = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/replies`)
      .send({ body: 'This has come back.' });

    expect(response.status).toBe(201);
    expect(response.body.reopened).toBe(true);

    const ticket = await Ticket.findByPk(world.ticketA.id);
    expect(ticket?.status).toBe('open');

    // Attributed to the SYSTEM, not to a person, and not to the customer: the
    // customer holds no permission to transition anything (Phase 6's system
    // actor, reused rather than reinvented).
    const transition = await TicketHistory.findOne({
      where: { ticket_id: world.ticketA.id, event: 'ticket.status.changed' },
    });

    expect(transition).not.toBeNull();
    expect(transition?.actor_user_id).toBeNull();
  });

  it('a reply on a CLOSED request is refused, and stores nothing (FR-036)', async () => {
    await Ticket.update({ status: 'closed' }, { where: { id: world.ticketA.id } });

    const response = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/replies`)
      .send({ body: 'One more thing.' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('TICKET_SETTLED');

    // NOTHING WAS ACCEPTED. A stored reply on a closed ticket that nobody will
    // ever answer is a silent discard with extra steps.
    expect(await Message.count({ where: { ticket_id: world.ticketA.id } })).toBe(0);

    const ticket = await Ticket.findByPk(world.ticketA.id);
    expect(ticket?.status).toBe('closed');
  });

  it('the reply affordance matches the boundary the endpoint enforces', async () => {
    for (const [status, offered] of [
      ['open', true],
      ['pending', true],
      ['escalated', true],
      ['resolved', true],
      ['closed', false],
    ] as const) {
      await Ticket.update({ status }, { where: { id: world.ticketA.id } });

      const view = await portalAgent(world.a.accessToken).get(
        `/api/portal/tickets/${world.ticketA.reference}`,
      );

      // The screen and the endpoint read the SAME declaration, so they cannot
      // disagree about which states accept a reply.
      expect(view.body.replyOffered).toBe(offered);
    }
  });
});

describe('an agent can answer where the customer wrote (research D6)', () => {
  it('conversationFor returns a portal conversation for a portal-only ticket', async () => {
    const world = await buildPortalWorld();

    await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/replies`)
      .send({ body: 'Hello?' });

    const conversation = await messageService.conversationFor(world.ticketA.id);

    // THE TEST THAT JUSTIFIES THE DESIGN. Had `portal` been left out of
    // REPLYABLE_CHANNELS, this would be null and the agent's composer would have
    // nothing to offer — a customer who raised a request in the portal could
    // never be answered in it.
    expect(conversation).not.toBeNull();
    expect(conversation?.channel).toBe('portal');
    expect(conversation?.recipientIdentity).toBe(world.a.email);
  });

  it('an outbound portal message becomes `read` when the customer opens the request', async () => {
    const world = await buildPortalWorld();

    await Message.create({
      ticket_id: world.ticketA.id,
      channel: 'portal',
      direction: 'outbound',
      author_user_id: null,
      sender_identity: null,
      sender_identity_normalised: null,
      body: 'Have you tried the other socket?',
      body_format: 'text',
      provider_message_id: 'reply-test-out',
      outbound_message_id: null,
      delivery_state: 'sent',
      delivery_detail: null,
      occurred_at: new Date(),
    });

    await portalAgent(world.a.accessToken).get(`/api/portal/tickets/${world.ticketA.reference}`);

    const message = await Message.findOne({ where: { provider_message_id: 'reply-test-out' } });

    // The one channel in this project that can assert `read` truthfully with no
    // provider to ask, because the read happened against our own endpoint.
    expect(message?.delivery_state).toBe('read');
  });
});
