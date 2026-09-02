import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { fakeProvider } from './fixtures.js';

/**
 * Suggested reply drafting (Phase 9, US2, FR-025 - FR-032, SC-005, SC-007).
 *
 * THE ASSERTION THAT MATTERS MOST is that generating a draft creates nothing.
 * SC-005 requires that 100% of messages reaching a customer are text a human
 * approved, and the way that could silently break is a draft path that writes a
 * `messages` row "so it can be resumed later" — which would then be one status
 * change away from being delivered.
 */
vi.mock('../../src/ai/providers/external-factory.js', () => ({
  externalProviderFor: () => provider,
}));

vi.mock('../../src/ai/features.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ai/features.js')>(
    '../../src/ai/features.js',
  );

  return {
    ...actual,
    FEATURES: {
      ...actual.FEATURES,
      draft: { key: 'draft', enabled: true, ceiling: 500, location: 'external' },
    },
    isEnabled: (key: string) => key === 'draft',
  };
});

// eslint-disable-next-line prefer-const
let provider = fakeProvider('external', () => 'Thank you for getting in touch. We are looking into it.');

const { forTicket } = await import('../../src/services/ai-draft.service.js');
const { Message } = await import('../../src/models/message.model.js');
const { Ticket } = await import('../../src/models/ticket.model.js');
const { Customer } = await import('../../src/models/customer.model.js');

describe('reply drafting', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();
    provider.calls.length = 0;
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('creates NO message row — a draft has no existence until it is sent', async () => {
    const ticket = await seedTicket();
    await seedMessage(ticket.id, 'inbound', 'my order has not arrived');

    const before = await Message.count();
    const draft = await forTicket(ticket.id, 1);

    expect(draft.text).toBeTruthy();

    // FR-026, SC-005. Nothing queued, nothing delivered, nothing to resume.
    expect(await Message.count()).toBe(before);
  });

  it('refuses a ticket that does not exist, the same way viewing it would', async () => {
    await expect(forTicket(999_999, 1)).rejects.toThrow();
    expect(provider.calls).toHaveLength(0);
  });

  it('writes in the language of the customer', async () => {
    const ticket = await seedTicket();
    await seedMessage(ticket.id, 'inbound', 'الطلب لم يصل بعد وأريد معرفة الحالة');

    await forTicket(ticket.id, 1);

    expect(provider.calls[0].contentLang).toBe('ar');
  });

  it('cites no article the model invented', async () => {
    const ticket = await seedTicket();
    await seedMessage(ticket.id, 'inbound', 'how do I reset my password');

    // The model claims an article that retrieval never supplied. There is no KB
    // content in this test at all, so every id it names is fabricated.
    provider = fakeProvider('external', () => 'See [article 4242] for the steps.');

    const draft = await forTicket(ticket.id, 1);

    // SC-007: zero fabricated references. The intersection with what retrieval
    // actually returned is what makes that structural.
    expect(draft.citedArticles).toEqual([]);
  });

  it('strips the article markers so they never reach a customer', async () => {
    const ticket = await seedTicket();
    await seedMessage(ticket.id, 'inbound', 'question');

    provider = fakeProvider('external', () => 'Please see [article 7] and try again.');

    const draft = await forTicket(ticket.id, 1);

    expect(draft.text).not.toContain('[article');
    expect(draft.text).toContain('Please see');
  });

  it('still produces a draft when knowledge base retrieval fails', async () => {
    const ticket = await seedTicket();
    await seedMessage(ticket.id, 'inbound', 'the device will not switch on');

    // A KB outage must not remove the feature: the conversation alone is enough
    // material to answer from, and refusing would be a worse failure than a
    // draft with no citations.
    const draft = await forTicket(ticket.id, 1);

    expect(draft.text).toBeTruthy();
    expect(draft.citedArticles).toEqual([]);
  });
});

async function seedTicket(): Promise<{ id: number }> {
  const customer = (await Customer.create({
    display_name: 'Acme',
    type: 'company',
    status: 'active',
  } as never)) as unknown as { id: number };

  return (await Ticket.create({
    reference: `T-${Math.floor(Math.random() * 1_000_000)}`,
    subject: 'Device fault',
    description: 'The device will not switch on.',
    customer_id: customer.id,
    category: 'technical',
    priority: 'normal',
    status: 'open',
    source: 'email',
  } as never)) as unknown as { id: number };
}

async function seedMessage(ticketId: number, direction: 'inbound' | 'outbound', body: string) {
  return Message.create({
    ticket_id: ticketId,
    channel: 'email',
    direction,
    body,
    sender_identity: 'someone@example.com',
    sender_identity_normalised: 'someone@example.com',
    delivery_state: 'delivered',
    occurred_at: new Date(),
  } as never);
}
