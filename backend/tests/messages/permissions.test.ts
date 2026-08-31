import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/channels/simulator-store.js';
import { Message, Role, RolePermission } from '../../src/models/index.js';
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

async function revoke(roleKey: string, permissionKey: string): Promise<void> {
  const role = await Role.findOne({ where: { key: roleKey } });
  await RolePermission.destroy({ where: { role_id: role?.id, permission_key: permissionKey } });
}

/**
 * US3 — the two composers on one screen need two grants (FR-043, FR-103,
 * SC-006, SC-012).
 *
 * This is the file that proves the separation is real rather than cosmetic. An
 * internal note is written to a colleague under an expectation of privacy; a
 * reply speaks to a customer in the organisation's name. Holding the authority
 * to do one must not confer the other.
 */
describe('messages:send is enforced server-side (FR-103)', () => {
  it('refuses a reply from an agent without the key, even though the UI hides it', async () => {
    await revoke('agent', 'messages:send');

    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');

    // Nothing left the building, and nothing was recorded as though it had.
    expect(outbox()).toHaveLength(0);
    expect(await Message.count({ where: { direction: 'outbound' } })).toBe(0);
  });

  it('holding ticket_notes:create does NOT confer messages:send', async () => {
    // The two grants are independent. An agent who may annotate a ticket is not
    // automatically an agent who may speak to the customer.
    await revoke('agent', 'messages:send');

    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    // The note endpoint still works…
    const note = await agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: 'Internal thought' });

    expect(note.status).toBe(201);

    // …and the message endpoint still refuses.
    const message = await agent
      .post(`/api/tickets/${ticket.id}/messages`)
      .send({ body: 'To the customer' });

    expect(message.status).toBe(403);
  });

  it('holding messages:send does NOT confer ticket_notes:create', async () => {
    // And symmetrically. Neither implies the other.
    await revoke('agent', 'ticket_notes:create');

    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    const message = await agent
      .post(`/api/tickets/${ticket.id}/messages`)
      .send({ body: 'To the customer' });

    expect(message.status).toBe(201);

    const note = await agent.post(`/api/tickets/${ticket.id}/notes`).send({ body: 'Internal' });

    expect(note.status).toBe(403);
  });

  it('allows reading a thread with only tickets:view', async () => {
    // Anyone who may read the ticket may read the conversation on it. There is
    // deliberately no separate "read messages" permission — a key every role
    // holds unconditionally cannot refuse anything.
    await revoke('agent', 'messages:send');

    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    const response = await agent.get(`/api/tickets/${ticket.id}/messages`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
  });
});

describe('messages:reattribute (FR-017)', () => {
  it('is refused to an ordinary agent', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    const response = await agent
      .post(`/api/tickets/${ticket.id}/reattribute`)
      .send({ customerId: 1, version: ticket.version });

    expect(response.status).toBe(403);
  });

  it('moves the conversation and records who did it', async () => {
    const { agent, user } = await agentAs('supervisor');
    const first = await seedConversation();
    const second = await seedConversation({ identity: 'other@example.com' });

    const response = await agent
      .post(`/api/tickets/${first.ticket.id}/reattribute`)
      .send({ customerId: second.customer.id, version: first.ticket.version });

    expect(response.status).toBe(200);

    const { Ticket, AuditLog } = await import('../../src/models/index.js');
    const moved = await Ticket.findByPk(first.ticket.id);

    expect(moved?.customer_id).toBe(second.customer.id);

    const entry = await AuditLog.findOne({ where: { action: 'ticket.reattributed' } });
    expect(entry?.actor_user_id).toBe(user.id);
  });

  it('refuses a stale version', async () => {
    const { agent } = await agentAs('supervisor');
    const first = await seedConversation();
    const second = await seedConversation({ identity: 'other@example.com' });

    const response = await agent
      .post(`/api/tickets/${first.ticket.id}/reattribute`)
      .send({ customerId: second.customer.id, version: first.ticket.version + 5 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });
});
