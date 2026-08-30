import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CustomerNote } from '../../src/models/index.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedTicket } from '../tickets/helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * The context panel is the half of PLAN.md's Definition of done that says
 * "without navigating away". These tests hold it to that: everything the agent
 * needs arrives in ONE call, and losing the panel never costs them the ticket.
 */
describe('GET /api/tickets/:id/context', () => {
  it('returns the customer, their other tickets, and their recent notes in one call', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const ticket = await seedTicket({ customer, createdBy: user, assignee: user, status: 'open' });
    const other = await seedTicket({ customer, createdBy: user, status: 'pending' });
    await CustomerNote.create({
      customer_id: customer.id,
      author_user_id: user.id,
      body: 'Prefers to be called in the morning.',
    });

    const response = await agent.get(`/api/tickets/${ticket.id}/context`);

    expect(response.status).toBe(200);
    expect(response.body.customer.id).toBe(customer.id);
    expect(response.body.customer.isActive).toBe(true);

    // The ticket being viewed is not listed among "other" tickets — it is on
    // the screen already.
    expect(response.body.otherTickets.map((t: { id: number }) => t.id)).toEqual([other.id]);
    expect(response.body.recentNotes).toHaveLength(1);
    expect(response.body.recentNotes[0].author.id).toBe(user.id);
  });

  it('bounds other tickets and recent notes rather than returning everything', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: user, assignee: user });

    for (let index = 0; index < 9; index += 1) {
      await seedTicket({ customer, createdBy: user });
      await CustomerNote.create({
        customer_id: customer.id,
        author_user_id: user.id,
        body: `Note ${index}`,
      });
    }

    const response = await agent.get(`/api/tickets/${ticket.id}/context`);

    // A panel is a summary. An unbounded one turns the ticket screen into a
    // customer export (FR-014, FR-015, FR-085).
    expect(response.body.otherTickets.length).toBeLessThanOrEqual(5);
    expect(response.body.recentNotes.length).toBeLessThanOrEqual(5);
  });

  it('excludes merged tickets from the customer’s other tickets', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: user, assignee: user });
    const survivor = await seedTicket({ customer, createdBy: user });
    await seedTicket({ customer, createdBy: user, mergedInto: survivor });

    const response = await agent.get(`/api/tickets/${ticket.id}/context`);

    expect(response.body.otherTickets.map((t: { id: number }) => t.id)).toEqual([survivor.id]);
  });

  it('reports a deactivated customer without blocking the ticket (FR-016)', async () => {
    const { user, agent } = await agentAs('agent');
    const admin = await agentAs('admin');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: user, assignee: user, status: 'open' });

    await admin.agent.post(`/api/customers/${customer.id}/deactivate`);

    const response = await agent.get(`/api/tickets/${ticket.id}/context`);

    expect(response.status).toBe(200);
    expect(response.body.customer.isActive).toBe(false);

    // The ticket is still workable. Phase 2 chose deactivation over deletion
    // precisely so this stays true.
    expect((await agent.get(`/api/tickets/${ticket.id}`)).status).toBe(200);
  });

  it('shows the raw contact value, not the normalised one', async () => {
    // value_normalised exists for duplicate matching. Reading a normalised
    // phone number aloud to a customer would be actively unhelpful.
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer({
      contacts: [{ kind: 'phone', value: '+20 100 123 4567', isPrimary: true }],
    });
    const ticket = await seedTicket({ customer, createdBy: user, assignee: user });

    const response = await agent.get(`/api/tickets/${ticket.id}/context`);

    expect(response.body.customer.contacts[0].value).toBe('+20 100 123 4567');
  });

  it('404s for a ticket that does not exist', async () => {
    const { agent } = await agentAs('agent');

    expect((await agent.get('/api/tickets/999999/context')).status).toBe(404);
  });
});

describe('the panel is an enhancement, not a gate (FR-018)', () => {
  it('refuses the panel without customers:view while every ticket action still works', async () => {
    const { user, agent } = await agentAs('agent');
    const admin = await agentAs('admin');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: user, assignee: user, status: 'open' });

    const roles = await admin.agent.get('/api/admin/roles');
    const agentRole = roles.body.items.find((role: { key: string }) => role.key === 'agent');

    await admin.agent.put(`/api/admin/roles/${agentRole.id}/permissions`).send({
      permissions: agentRole.permissions.filter((key: string) => key !== 'customers:view'),
      version: agentRole.version,
    });

    const context = await agent.get(`/api/tickets/${ticket.id}/context`);
    expect(context.status).toBe(403);

    // Everything that matters about the ticket still works. Losing the panel
    // must cost the agent context, never capability.
    expect((await agent.get(`/api/tickets/${ticket.id}`)).status).toBe(200);
    expect((await agent.get(`/api/tickets/${ticket.id}/history`)).status).toBe(200);
    expect((await agent.get('/api/dashboard/queue')).status).toBe(200);
  });
});
