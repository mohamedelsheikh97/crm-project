import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { fakeProvider } from './fixtures.js';

/**
 * Category proposals (Phase 9, US4, Clarifications Q2, SC-010 - SC-012).
 *
 * THE FIRST TEST IN THIS FILE IS THE MOST IMPORTANT IN THE PHASE.
 *
 * SC-012 requires that no ticket's category is ever changed by anything other
 * than a human action. If that breaks, Phase 6's automation conditions and SLA
 * policy selection start acting on a probabilistic guess — and the resulting
 * breach or misroute presents as a Phase 6 bug, in code that has not changed.
 * It would be a very expensive thing to debug.
 */
let provider = fakeProvider('external');

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
      classify: { key: 'classify', enabled: true, ceiling: 2000, location: 'external' },
    },
    isEnabled: (key: string) => key === 'classify',
  };
});

const classifyService = await import('../../src/services/ai-classify.service.js');
const { AiCategoryProposal } = await import('../../src/models/ai-category-proposal.model.js');
const { Ticket } = await import('../../src/models/ticket.model.js');
const { Customer } = await import('../../src/models/customer.model.js');

function respondsWith(category: string, confidence: number) {
  provider = fakeProvider('external', () => JSON.stringify({ category, confidence }));
}

describe('classification proposes and never applies', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();
    respondsWith('billing', 0.95);
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('NEVER writes tickets.category (SC-012, FR-045b)', async () => {
    const ticket = await seedTicket('general');

    await classifyService.proposeFor(ticket.id);

    const after = (await Ticket.findByPk(ticket.id)) as { category: string };

    // The proposal exists; the ticket is untouched.
    expect(after.category).toBe('general');
    expect(await AiCategoryProposal.count({ where: { state: 'pending' } })).toBe(1);
  });

  it('records what it proposed and what the category was at the time', async () => {
    const ticket = await seedTicket('general');

    await classifyService.proposeFor(ticket.id);

    const proposal = (await AiCategoryProposal.findOne()) as {
      proposed: string;
      confidence: number | null;
      category_at_proposal: string;
      state: string;
    };

    expect(proposal.proposed).toBe('billing');
    expect(proposal.confidence).toBeCloseTo(0.95, 3);
    expect(proposal.category_at_proposal).toBe('general');
    expect(proposal.state).toBe('pending');
  });

  it('makes NO proposal below the confidence threshold (FR-048)', async () => {
    const ticket = await seedTicket('general');
    respondsWith('billing', 0.2);

    await classifyService.proposeFor(ticket.id);

    // An absent proposal is a valid outcome, not a failure.
    expect(await AiCategoryProposal.count()).toBe(0);
  });

  it('makes NO proposal for a category outside the Phase 3 taxonomy', async () => {
    const ticket = await seedTicket('general');
    respondsWith('refunds-and-returns', 0.99);

    await classifyService.proposeFor(ticket.id);

    // An invented category cannot reach the database, however confident the
    // model was about it.
    expect(await AiCategoryProposal.count()).toBe(0);
  });

  it('makes NO proposal from an unparseable response', async () => {
    const ticket = await seedTicket('general');
    provider = fakeProvider('external', () => 'I think this is probably a billing issue.');

    await classifyService.proposeFor(ticket.id);

    expect(await AiCategoryProposal.count()).toBe(0);
  });

  it('makes no proposal when the ticket already holds that category', async () => {
    const ticket = await seedTicket('billing');

    await classifyService.proposeFor(ticket.id);

    expect(await AiCategoryProposal.count()).toBe(0);
  });

  it('does not propose twice for one ticket (FR-047)', async () => {
    const ticket = await seedTicket('general');

    await classifyService.proposeFor(ticket.id);
    await classifyService.proposeFor(ticket.id);

    expect(await AiCategoryProposal.count()).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('SUPPRESSES a pending proposal once a human has categorised the ticket (FR-049)', async () => {
    const ticket = await seedTicket('general');
    await classifyService.proposeFor(ticket.id);

    expect(await classifyService.pendingFor(ticket.id)).not.toBeNull();

    // A colleague triages it in the meantime.
    await Ticket.update({ category: 'technical' }, { where: { id: ticket.id } });

    // Gone from the interface, but NOT marked dismissed — nobody dismissed it,
    // and SC-011 should be able to tell those apart.
    expect(await classifyService.pendingFor(ticket.id)).toBeNull();

    const row = (await AiCategoryProposal.findOne()) as { state: string };
    expect(row.state).toBe('pending');
  });

  it('never throws to its caller, so intake cannot fail because of it', async () => {
    const ticket = await seedTicket('general');
    provider.failWith(new Error('provider exploded'));

    // FR-004: a ticket that exists uncategorised is fine. A ticket that failed
    // to be raised is a lost customer.
    await expect(classifyService.proposeFor(ticket.id)).resolves.toBeUndefined();
  });

  it('reads only the subject and the first inbound message', async () => {
    const ticket = await seedTicket('general');
    const { Message } = await import('../../src/models/message.model.js');

    await Message.create({
      ticket_id: ticket.id,
      channel: 'email',
      direction: 'inbound',
      body: 'FIRST-INBOUND the invoice is wrong',
      sender_identity: 'a@example.com',
      sender_identity_normalised: 'a@example.com',
      delivery_state: 'delivered',
      occurred_at: new Date(Date.now() - 60_000),
    } as never);

    await Message.create({
      ticket_id: ticket.id,
      channel: 'email',
      direction: 'inbound',
      body: 'LATER-REPLY thanks for looking',
      sender_identity: 'a@example.com',
      sender_identity_normalised: 'a@example.com',
      delivery_state: 'delivered',
      occurred_at: new Date(),
    } as never);

    await classifyService.proposeFor(ticket.id);

    const sent = provider.calls[0].messages[0].content;

    // The rest of the thread is a conversation about the problem, not a
    // statement of what kind of problem it is.
    expect(sent).toContain('FIRST-INBOUND');
    expect(sent).not.toContain('LATER-REPLY');
  });
});

async function seedTicket(category: string): Promise<{ id: number }> {
  const customer = (await Customer.create({
    display_name: 'Acme',
    type: 'company',
    status: 'active',
  } as never)) as unknown as { id: number };

  return (await Ticket.create({
    customer_id: customer.id,
    subject: 'The invoice shows the wrong amount',
    description: 'We were charged twice this month.',
    category,
    priority: 'normal',
    status: 'new',
    source: 'email',
  } as never)) as unknown as { id: number };
}
