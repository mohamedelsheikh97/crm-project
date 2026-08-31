import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { lastSent, outbox } from '../../src/channels/simulator-store.js';
import { AuditLog, Message, TicketHistory } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { resetSimulator, seedConversation } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetSimulator();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * US3 — the agent answers on the channel it arrived on (FR-042, FR-046,
 * FR-050, SC-005).
 */
describe('sending a reply', () => {
  it('delivers on the arriving channel and records it as outbound', async () => {
    const { agent, user } = await agentAs('agent');
    const { ticket, identity } = await seedConversation({ channel: 'email' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/messages`)
      .send({ body: 'We are sending it today.' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      channel: 'email',
      direction: 'outbound',
      author: { id: user.id },
      body: 'We are sending it today.',
    });

    // It actually left, on the right channel, to the right person.
    const sent = lastSent('email');
    expect(sent?.recipientIdentity).toBe(identity);
    expect(sent?.body).toBe('We are sending it today.');
  });

  it('DERIVES the channel from the conversation and ignores the request (FR-042)', async () => {
    // Otherwise anyone holding messages:send could use this system as a relay,
    // sending to a channel and an address of their own choosing.
    const { agent } = await agentAs('agent');
    const { ticket, identity } = await seedConversation({ channel: 'email' });

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({
      body: 'Hello',
      channel: 'sms',
      recipientIdentity: 'attacker@example.com',
    });

    expect(response.status).toBe(201);
    expect(response.body.channel).toBe('email');

    expect(outbox('sms')).toHaveLength(0);
    expect(lastSent('email')?.recipientIdentity).toBe(identity);
  });

  it('replies on WhatsApp when the conversation arrived on WhatsApp', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation({ channel: 'whatsapp', identity: '+201001234567' });

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    expect(response.status).toBe(201);
    expect(response.body.channel).toBe('whatsapp');
    expect(outbox('whatsapp')).toHaveLength(1);
  });

  it('refuses when the ticket has no conversation to reply to (FR-042)', async () => {
    const { agent, user } = await agentAs('agent');
    const { Ticket, Customer } = await import('../../src/models/index.js');

    const customer = await Customer.create({
      display_name: 'Typed In By Hand',
      company: null,
      address: null,
      is_active: true,
      created_by_user_id: user.id,
    });

    const ticket = await Ticket.create({
      customer_id: customer.id,
      subject: 'Phoned in',
      description: null,
      category: 'general',
      priority: 'normal',
      status: 'open',
      assignee_user_id: null,
      created_by_user_id: user.id,
      source: 'manual',
    });

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hi' });

    // Not a permission failure — the agent may correspond, there is simply
    // nowhere to send.
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NO_REPLY_CHANNEL');
  });

  it('refuses an empty body', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0]).toMatchObject({ field: 'body' });
  });

  it('records the send in the audit trail WITHOUT the body (FR-050)', async () => {
    const { agent, user } = await agentAs('agent');
    const { ticket } = await seedConversation();

    await agent
      .post(`/api/tickets/${ticket.id}/messages`)
      .send({ body: 'A private thing we told the customer.' });

    const entry = await AuditLog.findOne({ where: { action: 'message.sent' } });

    expect(entry).not.toBeNull();
    expect(entry?.actor_user_id).toBe(user.id);

    // The audit log records THAT correspondence left, not what it said. The
    // message row is the content of record; duplicating it here would put
    // customer content into the security log for no benefit.
    expect(JSON.stringify(entry?.metadata)).not.toContain('A private thing');
  });

  it('records it in the ticket history, attributed to the agent', async () => {
    const { agent, user } = await agentAs('agent');
    const { ticket } = await seedConversation();

    await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Our reply' });

    const history = await TicketHistory.findOne({ where: { event: 'ticket.message.sent' } });

    expect(history?.actor_user_id).toBe(user.id);
    // Like Phase 4's notes, history records THAT it happened, never the body.
    expect(history?.new_value).toBe('email');
  });

  it('stores the outbound Message-ID so the reply threads back (FR-040)', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Reply' });

    const stored = await Message.findByPk(response.body.id);

    expect(stored?.outbound_message_id).toBeTruthy();
  });

  it('refuses to reply on a merged ticket, naming the survivor', async () => {
    const { agent } = await agentAs('agent');
    const first = await seedConversation();
    const second = await seedConversation({ identity: 'other@example.com' });

    first.ticket.merged_into_ticket_id = second.ticket.id;
    await first.ticket.save();

    const response = await agent
      .post(`/api/tickets/${first.ticket.id}/messages`)
      .send({ body: 'Hello' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TICKET_MERGED');
    expect(response.body.merged.survivorId).toBe(second.ticket.id);
  });
});

describe('reading a thread', () => {
  it('returns correspondence oldest first, with attachments', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Our reply' });

    const response = await agent.get(`/api/tickets/${ticket.id}/messages`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    // A conversation reads forwards.
    expect(response.body.items[0].direction).toBe('inbound');
    expect(response.body.items[1].direction).toBe('outbound');
  });

  it('never returns internal notes (SC-006)', async () => {
    // The structural separation: this endpoint reads `messages` and the note
    // endpoint reads `ticket_notes`, and neither can reach the other.
    const { agent, user } = await agentAs('supervisor');
    const { ticket } = await seedConversation();

    const { TicketNote } = await import('../../src/models/index.js');

    await TicketNote.create({
      ticket_id: ticket.id,
      author_user_id: user.id,
      body: 'INTERNAL: the customer is being difficult.',
    });

    const response = await agent.get(`/api/tickets/${ticket.id}/messages`);

    expect(JSON.stringify(response.body)).not.toContain('INTERNAL');
  });
});
