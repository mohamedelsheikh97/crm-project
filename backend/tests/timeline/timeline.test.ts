import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Message, Role, RolePermission, TicketNote } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { resetSimulator, seedConversation } from '../messages/helpers.js';

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
 * US4 — one customer, one conversation (FR-087-FR-093, SC-007, SC-008).
 *
 * The most important test here is the LAST one: the timeline holds
 * correspondence only, which is the property that makes it safe for Phase 8 to
 * build a customer-facing view on.
 */
describe('the customer timeline', () => {
  it('gathers correspondence across channels and tickets into one sequence', async () => {
    const { agent } = await agentAs('agent');
    const first = await seedConversation({ channel: 'email' });

    // A second ticket for the SAME customer, on a different channel.
    const { Ticket } = await import('../../src/models/index.js');

    const second = await Ticket.create({
      customer_id: first.customer.id,
      subject: 'A different question',
      description: null,
      category: 'general',
      priority: 'normal',
      status: 'open',
      assignee_user_id: null,
      created_by_user_id: null,
      source: 'whatsapp',
    });

    await Message.create({
      ticket_id: second.id,
      channel: 'whatsapp',
      direction: 'inbound',
      author_user_id: null,
      sender_identity: '+201001234567',
      sender_identity_normalised: '+201001234567',
      body: 'Sent on WhatsApp',
      body_format: 'text',
      delivery_state: 'delivered',
      occurred_at: new Date(),
    });

    const response = await agent.get(`/api/customers/${first.customer.id}/timeline`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);

    const channels = response.body.items.map((entry: { channel: string }) => entry.channel);
    expect(channels).toContain('email');
    expect(channels).toContain('whatsapp');
  });

  it('identifies channel, direction, time and ticket on every entry (FR-088, FR-089)', async () => {
    const { agent } = await agentAs('agent');
    const { customer, ticket } = await seedConversation();

    const response = await agent.get(`/api/customers/${customer.id}/timeline`);

    expect(response.body.items[0]).toMatchObject({
      channel: 'email',
      direction: 'inbound',
      ticket: { id: ticket.id, reference: expect.stringMatching(/^TKT-\d{6}$/) },
    });

    expect(response.body.items[0].occurredAt).toBeTruthy();
  });

  it('orders by WHEN IT HAPPENED, not by when we recorded it (FR-092)', async () => {
    // These diverge whenever a poller catches up or a provider redelivers late.
    // A customer's message belongs where they sent it.
    const { agent } = await agentAs('agent');
    const { customer, ticket } = await seedConversation();

    // Recorded now, but it happened long before the seeded message.
    await Message.create({
      ticket_id: ticket.id,
      channel: 'email',
      direction: 'inbound',
      author_user_id: null,
      sender_identity: 'hala@example.com',
      sender_identity_normalised: 'hala@example.com',
      body: 'An older message that arrived late',
      body_format: 'text',
      delivery_state: 'delivered',
      occurred_at: new Date('2026-01-01T09:00:00Z'),
    });

    const response = await agent.get(`/api/customers/${customer.id}/timeline`);

    // Newest first, so the late arrival sorts to the BOTTOM despite being the
    // most recently created row.
    const bodies = response.body.items.map((entry: { preview: string }) => entry.preview);
    expect(bodies[bodies.length - 1]).toContain('An older message');
  });

  it('pages, rather than loading a long history at once (FR-091)', async () => {
    const { agent } = await agentAs('agent');
    const { customer, ticket } = await seedConversation();

    for (let i = 0; i < 5; i += 1) {
      await Message.create({
        ticket_id: ticket.id,
        channel: 'email',
        direction: 'inbound',
        author_user_id: null,
        sender_identity: 'hala@example.com',
        sender_identity_normalised: 'hala@example.com',
        body: `Message ${i}`,
        body_format: 'text',
        delivery_state: 'delivered',
        occurred_at: new Date(),
      });
    }

    const response = await agent.get(`/api/customers/${customer.id}/timeline?pageSize=2`);

    expect(response.body.items).toHaveLength(2);
    expect(response.body.total).toBe(6);
    expect(response.body.pageSize).toBe(2);
  });

  it('shortens a long body to a preview rather than shipping the whole thread', async () => {
    const { agent } = await agentAs('agent');
    const { customer, ticket } = await seedConversation();

    await Message.create({
      ticket_id: ticket.id,
      channel: 'email',
      direction: 'inbound',
      author_user_id: null,
      sender_identity: 'hala@example.com',
      sender_identity_normalised: 'hala@example.com',
      body: 'x'.repeat(5000),
      body_format: 'text',
      delivery_state: 'delivered',
      occurred_at: new Date(),
    });

    const response = await agent.get(`/api/customers/${customer.id}/timeline`);
    const longest = response.body.items.reduce(
      (max: number, entry: { preview: string }) => Math.max(max, entry.preview.length),
      0,
    );

    expect(longest).toBeLessThan(200);
  });

  it('CONTAINS NO INTERNAL NOTES AND NO HISTORY (FR-087a, SC-006)', async () => {
    // Clarifications Q3. This is the property Phase 8 will depend on: the
    // structure holds nothing internal, so a customer-facing view built on it
    // has nothing to leak. A later phase that adds notes here destroys that,
    // and it will not be obvious that it has.
    const { agent, user } = await agentAs('supervisor');
    const { customer, ticket } = await seedConversation();

    await TicketNote.create({
      ticket_id: ticket.id,
      author_user_id: user.id,
      body: 'INTERNAL: this customer disputes every invoice.',
    });

    const response = await agent.get(`/api/customers/${customer.id}/timeline`);

    expect(JSON.stringify(response.body)).not.toContain('INTERNAL');
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].channel).toBe('email');
  });

  it('discloses nothing from a ticket the viewer may not see (FR-090)', async () => {
    const { customer } = await seedConversation();

    // Revoke ticket visibility entirely: the timeline must narrow with it
    // rather than quietly disclosing.
    const role = await Role.findOne({ where: { key: 'agent' } });
    await RolePermission.destroy({ where: { role_id: role?.id, permission_key: 'tickets:view' } });

    const { agent } = await agentAs('agent');

    const response = await agent.get(`/api/customers/${customer.id}/timeline`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(0);
    // `total` counts only what the caller may see — a count including hidden
    // tickets would leak their existence through arithmetic.
    expect(response.body.total).toBe(0);
    // …but the interface is told correspondence EXISTS, so it can show
    // "not visible to you" rather than "never corresponded".
    expect(response.body.hasHiddenCorrespondence).toBe(true);
  });

  it('distinguishes a customer who has never corresponded', async () => {
    const { agent } = await agentAs('agent');
    const { Customer } = await import('../../src/models/index.js');

    const silent = await Customer.create({
      display_name: 'Never Wrote',
      company: null,
      address: null,
      is_active: true,
      created_by_user_id: null,
    });

    const response = await agent.get(`/api/customers/${silent.id}/timeline`);

    expect(response.body.total).toBe(0);
    // The other empty state. Phase 4 established that an unexplained empty
    // area is a defect; two empty states that look alike are the same defect.
    expect(response.body.hasHiddenCorrespondence).toBe(false);
  });
});
