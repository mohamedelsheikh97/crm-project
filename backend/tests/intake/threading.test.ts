import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { Message, Ticket, TicketLink } from '../../src/models/index.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { deliverEmail, seedCustomerWithEmail } from './helpers.js';

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
 * US1 — threading (research.md D4, FR-021-FR-025).
 *
 * The subject is NEVER consulted. That is the point of most of this file.
 */

/** Puts an outbound message on a ticket so a reply has something to thread to. */
async function seedOutbound(ticketId: number, messageId: string): Promise<Message> {
  return Message.create({
    ticket_id: ticketId,
    channel: 'email',
    direction: 'outbound',
    author_user_id: null,
    sender_identity: 'hala@example.com',
    sender_identity_normalised: 'hala@example.com',
    body: 'Our reply.',
    body_format: 'text',
    outbound_message_id: messageId,
    delivery_state: 'sent',
    occurred_at: new Date(),
  });
}

describe('a reply continues its conversation (FR-021)', () => {
  it('threads on In-Reply-To', async () => {
    await seedCustomerWithEmail('hala@example.com');

    const first = await deliverEmail({
      messageId: '<one@example.com>',
      from: 'hala@example.com',
      subject: 'Invoice',
      body: 'Where is it?',
    });

    if (first.status !== 'converted') throw new Error('setup failed');

    await seedOutbound(first.ticketId, '<our-reply@crm.local>');

    const reply = await deliverEmail({
      messageId: '<two@example.com>',
      from: 'hala@example.com',
      subject: 'Re: Invoice',
      body: 'Thanks.',
      inReplyTo: '<our-reply@crm.local>',
    });

    expect(reply.status).toBe('converted');
    if (reply.status === 'converted') {
      expect(reply.ticketId).toBe(first.ticketId);
      expect(reply.created).toBe(false);
    }

    expect(await Ticket.count()).toBe(1);
    expect(await Message.count()).toBe(3);
  });

  it('threads on a References chain when In-Reply-To is absent', async () => {
    await seedCustomerWithEmail('hala@example.com');

    const first = await deliverEmail({
      messageId: '<one@example.com>',
      from: 'hala@example.com',
      body: 'First',
    });

    if (first.status !== 'converted') throw new Error('setup failed');

    await seedOutbound(first.ticketId, '<our-reply@crm.local>');

    const reply = await deliverEmail({
      messageId: '<three@example.com>',
      from: 'hala@example.com',
      body: 'Third',
      references: ['<ancient@example.com>', '<our-reply@crm.local>'],
    });

    if (reply.status === 'converted') expect(reply.ticketId).toBe(first.ticketId);
    expect(await Ticket.count()).toBe(1);
  });

  it('STILL THREADS when the customer rewrites the subject entirely (FR-023)', async () => {
    // The reason threading never touches the subject: customers edit them,
    // clients translate them, and every mail program prefixes them differently.
    await seedCustomerWithEmail('hala@example.com');

    const first = await deliverEmail({
      messageId: '<one@example.com>',
      from: 'hala@example.com',
      subject: 'Invoice question',
      body: 'First',
    });

    if (first.status !== 'converted') throw new Error('setup failed');

    await seedOutbound(first.ticketId, '<our-reply@crm.local>');

    const reply = await deliverEmail({
      messageId: '<two@example.com>',
      from: 'hala@example.com',
      subject: 'completely different words',
      body: 'Second',
      inReplyTo: '<our-reply@crm.local>',
    });

    if (reply.status === 'converted') expect(reply.ticketId).toBe(first.ticketId);
    expect(await Ticket.count()).toBe(1);
  });

  it('NEVER threads on a matching subject alone (FR-023)', async () => {
    // Two customers writing "Invoice question" must not land on one ticket.
    await seedCustomerWithEmail('hala@example.com');
    await seedCustomerWithEmail('omar@example.com', 'Omar');

    await deliverEmail({
      messageId: '<a@example.com>',
      from: 'hala@example.com',
      subject: 'Invoice question',
      body: 'From Hala',
    });

    await deliverEmail({
      messageId: '<b@example.com>',
      from: 'omar@example.com',
      subject: 'Invoice question',
      body: 'From Omar',
    });

    expect(await Ticket.count()).toBe(2);
  });

  it('lands a reply to a MERGED ticket on the survivor (FR-024)', async () => {
    await seedCustomerWithEmail('hala@example.com');

    const first = await deliverEmail({
      messageId: '<one@example.com>',
      from: 'hala@example.com',
      body: 'First',
    });

    const second = await deliverEmail({
      messageId: '<two@example.com>',
      from: 'hala@example.com',
      subject: 'Separate',
      body: 'Second',
      inReplyTo: null,
    });

    if (first.status !== 'converted' || second.status !== 'converted') {
      throw new Error('setup failed');
    }

    // Merge the first into the second, as Phase 3 does.
    const merged = await Ticket.findByPk(first.ticketId);
    if (merged) {
      merged.merged_into_ticket_id = second.ticketId;
      await merged.save();
    }

    await seedOutbound(first.ticketId, '<our-reply@crm.local>');

    const reply = await deliverEmail({
      messageId: '<three@example.com>',
      from: 'hala@example.com',
      body: 'A reply to the merged one',
      inReplyTo: '<our-reply@crm.local>',
    });

    // On the survivor, not on the redirect nobody is working.
    if (reply.status === 'converted') expect(reply.ticketId).toBe(second.ticketId);
  });
});

describe('a reply to a CLOSED ticket links, it does not reopen (research D8, FR-025)', () => {
  it('creates a new ticket linked to the closed one, leaving it closed', async () => {
    // The spec assumed this would reopen. It cannot: closed -> open carries
    // tickets:reopen, which Phase 3 restricted to Supervisors, and an inbound
    // message holds no permission at all.
    await seedCustomerWithEmail('hala@example.com');

    const first = await deliverEmail({
      messageId: '<one@example.com>',
      from: 'hala@example.com',
      subject: 'Card reader',
      body: 'It reboots.',
    });

    if (first.status !== 'converted') throw new Error('setup failed');

    const original = await Ticket.findByPk(first.ticketId);
    if (original) {
      original.status = 'closed';
      await original.save();
    }

    await seedOutbound(first.ticketId, '<our-reply@crm.local>');

    const reply = await deliverEmail({
      messageId: '<two@example.com>',
      from: 'hala@example.com',
      subject: 'Re: Card reader',
      body: 'It is happening again.',
      inReplyTo: '<our-reply@crm.local>',
    });

    expect(reply.status).toBe('converted');

    if (reply.status !== 'converted') return;

    // A NEW ticket, not the old one.
    expect(reply.ticketId).not.toBe(first.ticketId);
    expect(reply.created).toBe(true);

    // The closed ticket is untouched. Nothing bypassed the lifecycle gate.
    const stillClosed = await Ticket.findByPk(first.ticketId);
    expect(stillClosed?.status).toBe('closed');

    // And the two are linked, so the agent can see where this came from.
    const links = await TicketLink.findAll();
    expect(links).toHaveLength(1);
    expect([links[0]?.ticket_id, links[0]?.linked_ticket_id].sort()).toEqual(
      [first.ticketId, reply.ticketId].sort(),
    );
    // Nobody created this link, and the column now allows that.
    expect(links[0]?.created_by_user_id).toBeNull();
  });
});
