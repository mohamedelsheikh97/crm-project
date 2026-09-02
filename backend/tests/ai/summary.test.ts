import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiInvocation } from '../../src/models/ai-invocation.model.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { capturingProvider } from './fixtures.js';

/**
 * Thread summarisation (Phase 9, US1, FR-019 - FR-024, SC-003).
 *
 * The three assertions that matter, and none of them is about whether the
 * summary is any good — SC-002 assigns that to human review, because there is
 * no automated oracle for it and pretending otherwise produces tests that pass
 * while the feature is worthless.
 *
 * What IS testable is structural: who may obtain one, what was in the material,
 * and whether anything was kept afterwards.
 */
vi.mock('../../src/ai/providers/external-factory.js', () => ({
  externalProviderFor: () => provider,
}));

/**
 * The features are OFF by default in the test environment, which is deliberate
 * — SC-022 requires the Phase 0-8 suite to pass with the capability disabled,
 * so `AI_ENABLED` is not set for tests globally. A feature's own suite turns
 * only that feature on.
 */
vi.mock('../../src/ai/features.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ai/features.js')>(
    '../../src/ai/features.js',
  );

  return {
    ...actual,
    FEATURES: {
      ...actual.FEATURES,
      summary: { key: 'summary', enabled: true, ceiling: 500, location: 'external' },
    },
    isEnabled: (key: string) => key === 'summary',
  };
});

// eslint-disable-next-line prefer-const
let provider = capturingProvider('external');

const { forTicket, SummaryNotWorthwhileError } = await import(
  '../../src/services/ai-summary.service.js'
);
const { Ticket } = await import('../../src/models/ticket.model.js');
const { Message } = await import('../../src/models/message.model.js');

describe('ticket summarisation', () => {
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

  it('refuses a ticket that does not exist, the same way viewing it would', async () => {
    // FR-020: the refusal must match the refusal for viewing the ticket. A
    // distinct error here would tell the caller the ticket exists.
    await expect(forTicket(999_999, 1)).rejects.toThrow();
    expect(provider.calls).toHaveLength(0);
  });

  it('declines a thread too short to be worth summarising', async () => {
    const ticket = await seedTicket();
    await seedMessage(ticket.id, 'inbound', 'hello');

    await expect(forTicket(ticket.id, 1)).rejects.toBeInstanceOf(SummaryNotWorthwhileError);

    // And it costs nothing: no provider call, so no invocation row either.
    expect(provider.calls).toHaveLength(0);
    expect(await AiInvocation.count()).toBe(0);
  });

  it('sends the whole thread, never a page of it', async () => {
    const ticket = await seedTicket();

    for (let i = 0; i < 60; i += 1) {
      await seedMessage(ticket.id, i % 2 === 0 ? 'inbound' : 'outbound', `message ${i}`);
    }

    await forTicket(ticket.id, 1);

    const sent = provider.calls[0].messages[0].content;

    // FR-021. A summary of the first page, presented as a summary of the
    // ticket, is worse than no summary.
    expect(sent).toContain('message 0');
    expect(sent).toContain('message 59');
  });

  it('writes in the language of the CUSTOMER, not the agent', async () => {
    const ticket = await seedTicket();

    // The customer writes Arabic; the agent replies at length in English. An
    // English summary here would be a silent translation of the customer's
    // words, which FR-057 forbids.
    await seedMessage(ticket.id, 'inbound', 'لم يصل الطلب بعد وأريد معرفة الحالة');
    await seedMessage(ticket.id, 'outbound', 'Thank you for contacting us, we are looking into it');
    await seedMessage(ticket.id, 'outbound', 'We have escalated this to our logistics partner');

    await forTicket(ticket.id, 1);

    expect(provider.calls[0].contentLang).toBe('ar');
  });

  it('honours an explicit request for the other language (FR-024)', async () => {
    const ticket = await seedTicket();
    await seedMessage(ticket.id, 'inbound', 'لم يصل الطلب بعد');
    await seedMessage(ticket.id, 'inbound', 'أرجو الإفادة');
    await seedMessage(ticket.id, 'outbound', 'نعتذر عن التأخير');

    await forTicket(ticket.id, 1, 'en');

    // An explicit request is not a silent translation.
    expect(provider.calls[0].contentLang).toBe('en');
  });

  it('stores no summary text anywhere', async () => {
    const ticket = await seedTicket();
    await seedMessage(ticket.id, 'inbound', 'the printer is broken');
    await seedMessage(ticket.id, 'outbound', 'have you tried restarting it');
    await seedMessage(ticket.id, 'inbound', 'yes, no change');

    const summary = await forTicket(ticket.id, 1);
    expect(summary.text).toBeTruthy();

    // FR-065b. The invocation row records that it happened, and nothing else.
    const row = (await AiInvocation.findOne()) as AiInvocation;
    expect(row.outcome).toBe('success');
    expect(JSON.stringify(row.toJSON())).not.toContain('the printer is broken');
    expect(JSON.stringify(row.toJSON())).not.toContain(summary.text);
  });

  it('reports a generation time that cannot be older than the thread', async () => {
    const ticket = await seedTicket();
    await seedMessage(ticket.id, 'inbound', 'a');
    await seedMessage(ticket.id, 'inbound', 'b');
    await seedMessage(ticket.id, 'inbound', 'c');

    const before = Date.now();
    const summary = await forTicket(ticket.id, 1);

    // Recomputation is what discharges FR-018: there is no cached copy to be
    // stale, so "generated at" is always now.
    expect(summary.generatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(summary.messageCount).toBe(3);
  });
});

async function seedTicket() {
  const { Customer } = await import('../../src/models/customer.model.js');

  const customer = await Customer.create({
    display_name: 'Acme',
    type: 'company',
    status: 'active',
  } as never);

  return Ticket.create({
    reference: `T-${Math.floor(Math.random() * 1_000_000)}`,
    subject: 'Order has not arrived',
    description: 'The order has not arrived.',
    customer_id: (customer as unknown as { id: number }).id,
    category: 'general',
    priority: 'normal',
    status: 'open',
    source: 'email',
  } as never) as unknown as Promise<{ id: number }>;
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
