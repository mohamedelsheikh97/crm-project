import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog, Ticket } from '../../src/models/index.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs, createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedTicket } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('optimistic locking on a transition (FR-010)', () => {
  it('refuses a stale version', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'new' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'open', version: ticket.version + 5 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('refuses a missing version', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'new' });

    // A client that does not send it has not read the record it is overwriting.
    const response = await agent.post(`/api/tickets/${ticket.id}/transitions`).send({ to: 'open' });

    expect(response.status).toBe(409);
  });
});

/**
 * COVERS `tickets:close` AND `tickets:manage_any`, both declared conditional in
 * backend/tests/authorization.matrix.test.ts.
 *
 * A route-level probe cannot express "allowed for your own ticket, refused for
 * another's", which is exactly what Clarifications Q2 decided. This is where
 * that condition is proven.
 */
describe('closing is conditional on ownership (Clarifications Q2)', () => {
  it('lets an Agent close their own resolved ticket', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'resolved' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'closed', version: ticket.version });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('closed');
  });

  it("refuses an Agent closing another Agent's ticket", async () => {
    const owner = await createTestUser({ roleKey: 'agent' });
    const { user, agent } = await agentAs('agent');

    const ticket = await seedTicket({
      createdBy: user,
      assignee: owner,
      status: 'resolved',
    });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'closed', version: ticket.version });

    // The Agent holds tickets:close. What they lack is tickets:manage_any.
    expect(response.status).toBe(403);
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('resolved');
  });

  it("lets a Supervisor close another Agent's ticket, via tickets:manage_any", async () => {
    const owner = await createTestUser({ roleKey: 'agent' });
    const { agent } = await agentAs('supervisor');

    const ticket = await seedTicket({
      createdBy: owner,
      assignee: owner,
      status: 'resolved',
    });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'closed', version: ticket.version });

    expect(response.status).toBe(200);
  });

  it('does not offer Closed to an Agent who could not take it', async () => {
    const owner = await createTestUser({ roleKey: 'agent' });
    const { user, agent } = await agentAs('agent');

    const ticket = await seedTicket({ createdBy: user, assignee: owner, status: 'resolved' });

    const response = await agent.get(`/api/tickets/${ticket.id}/transitions`);

    expect(response.body.transitions).toEqual(['open']);
  });

  it('audits a closure under its own key', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'resolved' });

    await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'closed', version: ticket.version });

    // Not folded into ticket.status.changed: an administrator scanning for
    // "what was finished" should not have to read every status change.
    expect(await AuditLog.count({ where: { action: 'ticket.closed' } })).toBe(1);
  });
});

describe('a closed ticket cannot be edited (FR-009)', () => {
  it('refuses a PATCH with TICKET_CLOSED', async () => {
    const { user, agent } = await agentAs('supervisor');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'closed' });

    const response = await agent
      .patch(`/api/tickets/${ticket.id}`)
      .send({ subject: 'Changed', version: ticket.version });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TICKET_CLOSED');
  });
});

describe('status cannot be changed by an edit (FR-017)', () => {
  it('refuses `status` in a PATCH body', async () => {
    const { user, agent } = await agentAs('supervisor');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'new' });

    const response = await agent
      .patch(`/api/tickets/${ticket.id}`)
      .send({ status: 'resolved', version: ticket.version });

    // The lifecycle would be bypassed entirely if this were accepted — the
    // single most valuable refusal in the phase.
    expect(response.status).toBe(400);
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('new');
  });
});

describe('a refusal names where the ticket can actually go (FR-017)', () => {
  it('lists the reachable set on an undeclared pair', async () => {
    const { user, agent } = await agentAs('supervisor');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'new' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'resolved', version: ticket.version });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TRANSITION_NOT_ALLOWED');
    expect(response.body.transition.from).toBe('new');
    expect(response.body.transition.to).toBe('resolved');
    // Phase 6 added `new -> escalated` (research D11); `resolved` is still not
    // reachable from `new`, which is what this test is actually about.
    expect(response.body.transition.allowed).toEqual(['open', 'escalated']);
  });

  it('refuses a target that is not a status at all, and still says where to go', async () => {
    const { user, agent } = await agentAs('supervisor');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'new' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'banana', version: ticket.version });

    expect(response.status).toBe(422);
    expect(response.body.transition.allowed).toEqual(['open', 'escalated']);
  });
});

describe('editing a ticket (US1/US2)', () => {
  it('records one history entry per changed field (FR-033)', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({
      createdBy: user,
      assignee: user,
      status: 'open',
      subject: 'Old subject',
      priority: 'low',
    });

    const response = await agent
      .patch(`/api/tickets/${ticket.id}`)
      .send({ subject: 'New subject', priority: 'urgent', version: ticket.version });

    expect(response.status).toBe(200);

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const updates = history.body.items.filter(
      (item: { event: string }) => item.event === 'ticket.updated',
    );

    expect(updates).toHaveLength(2);

    const subjectChange = updates.find((item: { field: string }) => item.field === 'subject');
    expect(subjectChange.previousValue).toBe('Old subject');
    expect(subjectChange.newValue).toBe('New subject');
  });

  it('does not record a change that changes nothing', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, status: 'open', subject: 'Same' });

    await agent
      .patch(`/api/tickets/${ticket.id}`)
      .send({ subject: 'Same', version: ticket.version });

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const updates = history.body.items.filter(
      (item: { event: string }) => item.event === 'ticket.updated',
    );

    expect(updates).toHaveLength(0);
  });
});

describe('a ticket stays workable when its customer is deactivated (FR-008)', () => {
  it('still transitions', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ createdBy: user, assignee: user, customer, status: 'new' });

    await customer.update({ is_active: false });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'open', version: ticket.version });

    // Creating a NEW ticket for them is refused; abandoning work already under
    // way is a different and much worse thing.
    expect(response.status).toBe(200);
  });
});
