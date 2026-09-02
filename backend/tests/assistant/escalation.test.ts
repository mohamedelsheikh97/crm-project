import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AssistantConversation } from '../../src/models/assistant-conversation.model.js';
import { AssistantMessage } from '../../src/models/assistant-message.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { CustomerContact } from '../../src/models/customer-contact.model.js';
import { PortalAccount } from '../../src/models/portal-account.model.js';
import { Ticket } from '../../src/models/ticket.model.js';
import {
  AlreadyEscalatedError,
  escalate,
} from '../../src/services/assistant-escalation.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

/**
 * Handing a conversation to a person (Phase 9, US3, FR-036 - FR-036c, SC-017).
 *
 * The assertion that matters is idempotence. FR-036c is enforced by a UNIQUE
 * index rather than a check, so these tests exercise the second escalation
 * directly — the case a check-then-insert would pass in a test and lose in
 * production when a customer double-taps.
 */
describe('assistant escalation', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('creates one ticket carrying the conversation, attributed to the contact', async () => {
    const { conversationId, contactId, customerId } = await seedConversation();

    const result = await escalate(conversationId);

    expect(result.ticketReference).toBeTruthy();

    const tickets = await Ticket.findAll();
    expect(tickets).toHaveLength(1);

    const ticket = tickets[0] as unknown as {
      description: string;
      requesting_contact_id: number;
      customer_id: number;
      category: string;
      source: string;
      assistant_conversation_id: number;
    };

    // FR-036a: the conversation travels, so nobody repeats themselves.
    expect(ticket.description).toContain('my printer is broken');
    expect(ticket.description).toContain('Have you tried restarting it');

    // FR-036b: which part is the bot's is legible on the ticket.
    expect(ticket.description).toContain('automated assistant');

    // Phase 8 scoping: it appears in the customer's own request list.
    expect(ticket.requesting_contact_id).toBe(contactId);
    expect(ticket.customer_id).toBe(customerId);

    // Clarifications Q2: the DEFAULT category. Classification does not run on
    // this ticket and could not set one anyway.
    expect(ticket.category).toBe('general');
    expect(ticket.source).toBe('portal');
    expect(ticket.assistant_conversation_id).toBe(conversationId);
  });

  it('is IDEMPOTENT — a second escalation returns the first reference', async () => {
    const { conversationId } = await seedConversation();

    const first = await escalate(conversationId);

    await expect(escalate(conversationId)).rejects.toBeInstanceOf(AlreadyEscalatedError);

    // FR-036c. One conversation, one ticket, however many times the customer
    // taps the button.
    expect(await Ticket.count()).toBe(1);

    try {
      await escalate(conversationId);
    } catch (error) {
      // The customer sees the same number, not an error they must interpret.
      expect((error as AlreadyEscalatedError).ticketReference).toBe(first.ticketReference);
    }
  });

  it('links the conversation to the ticket exactly once', async () => {
    const { conversationId } = await seedConversation();

    await escalate(conversationId);

    const conversation = (await AssistantConversation.findByPk(
      conversationId,
    )) as AssistantConversation;

    expect(conversation.ticket_id).not.toBeNull();
    expect(conversation.escalated_at).not.toBeNull();

    const linked = await Ticket.count({
      where: { assistant_conversation_id: conversationId },
    });

    expect(linked).toBe(1);
  });

  it('uses the customer’s own words as the subject', async () => {
    const { conversationId } = await seedConversation();

    await escalate(conversationId);

    const ticket = (await Ticket.findOne()) as unknown as { subject: string };
    expect(ticket.subject).toBe('my printer is broken');
  });

  it('refuses to escalate a conversation with no identified contact', async () => {
    const conversation = (await AssistantConversation.create({
      // An anonymous chat visitor. The public route collects an email first and
      // goes through Phase 5 intake; reaching here without one is a caller bug.
      anon_token_hash: 'a'.repeat(64),
      lang: 'en',
      last_activity_at: new Date(),
    } as never)) as unknown as { id: number };

    await expect(escalate(conversation.id)).rejects.toThrow(/identified contact/);
    expect(await Ticket.count()).toBe(0);
  });
});

async function seedConversation(): Promise<{
  conversationId: number;
  contactId: number;
  customerId: number;
}> {
  const customer = (await Customer.create({
    display_name: 'Acme',
    type: 'company',
    status: 'active',
  } as never)) as unknown as { id: number };

  const contact = (await CustomerContact.create({
    customer_id: customer.id,
    kind: 'email',
    value_raw: 'someone@example.com',
    value_normalised: 'someone@example.com',
  } as never)) as unknown as { id: number };

  const account = (await PortalAccount.create({
    customer_contact_id: contact.id,
    password_hash: 'x'.repeat(60),
    activated_at: new Date(),
  } as never)) as unknown as { id: number };

  const conversation = (await AssistantConversation.create({
    portal_account_id: account.id,
    lang: 'en',
    last_activity_at: new Date(),
  } as never)) as unknown as { id: number };

  await AssistantMessage.create({
    conversation_id: conversation.id,
    role: 'customer',
    body: 'my printer is broken',
  } as never);

  await AssistantMessage.create({
    conversation_id: conversation.id,
    role: 'assistant',
    body: 'Have you tried restarting it?',
  } as never);

  return { conversationId: conversation.id, contactId: contact.id, customerId: customer.id };
}
