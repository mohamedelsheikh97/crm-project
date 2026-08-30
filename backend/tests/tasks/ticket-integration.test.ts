import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Task } from '../../src/models/index.js';
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
 * Where tasks meet Phase 3's ticket lifecycle. Both cases exist because a task
 * that quietly detaches from reality is worse than no task at all.
 */
describe('a task follows a merged ticket (FR-065)', () => {
  it('repoints at the survivor when its ticket is merged away', async () => {
    const supervisor = await agentAs('supervisor');
    const customer = await seedCustomer();

    const doomed = await seedTicket({
      customer,
      createdBy: supervisor.user,
      assignee: supervisor.user,
      status: 'open',
    });
    const survivor = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    const created = await supervisor.agent
      .post('/api/tasks')
      .send({ title: 'Call them back', ticketId: doomed.id });

    await supervisor.agent
      .post(`/api/tickets/${doomed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: doomed.version });

    const task = await Task.findByPk(created.body.id);

    // Left pointing at the merged ticket, the task would hang off a redirect
    // nobody can work.
    expect(task?.ticket_id).toBe(survivor.id);
  });

  it('follows a chain of merges to the ticket that is still workable', async () => {
    const supervisor = await agentAs('supervisor');
    const customer = await seedCustomer();

    const first = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });
    const middle = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });
    const survivor = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    const created = await supervisor.agent
      .post('/api/tasks')
      .send({ title: 'Still owed', ticketId: first.id });

    await supervisor.agent
      .post(`/api/tickets/${first.id}/merge`)
      .send({ intoTicketId: middle.id, version: first.version });

    await middle.reload();
    await supervisor.agent
      .post(`/api/tickets/${middle.id}/merge`)
      .send({ intoTicketId: survivor.id, version: middle.version });

    const task = await Task.findByPk(created.body.id);
    expect(task?.ticket_id).toBe(survivor.id);
  });

  it('leaves another user’s task on the same ticket attached too', async () => {
    // The repoint is by TICKET, not by owner — a merge must not strand
    // somebody else's follow-up just because they did not perform it.
    const supervisor = await agentAs('supervisor');
    const agent = await agentAs('agent');
    const customer = await seedCustomer();

    const doomed = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });
    const survivor = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    const created = await agent.agent
      .post('/api/tasks')
      .send({ title: 'Agent’s own follow-up', ticketId: doomed.id });

    await supervisor.agent
      .post(`/api/tickets/${doomed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: doomed.version });

    const task = await Task.findByPk(created.body.id);
    expect(task?.ticket_id).toBe(survivor.id);
  });
});

describe('closing a ticket surfaces outstanding tasks without refusing (FR-064)', () => {
  async function resolvedTicket() {
    const supervisor = await agentAs('supervisor');
    const customer = await seedCustomer();
    const ticket = await seedTicket({
      customer,
      createdBy: supervisor.user,
      assignee: supervisor.user,
      status: 'resolved',
    });

    return { supervisor, ticket };
  }

  it('returns the open tasks alongside the closed ticket', async () => {
    const { supervisor, ticket } = await resolvedTicket();

    await supervisor.agent
      .post('/api/tasks')
      .send({ title: 'Still owed to the customer', ticketId: ticket.id });

    const response = await supervisor.agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'closed', version: ticket.version });

    // Closed anyway. The person closing may well know the task is moot, and
    // blocking them would teach everyone to stop recording follow-ups.
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('closed');
    expect(response.body.outstandingTasks).toHaveLength(1);
    expect(response.body.outstandingTasks[0].title).toBe('Still owed to the customer');
  });

  it('omits the notice entirely when nothing is outstanding', async () => {
    const { supervisor, ticket } = await resolvedTicket();

    const response = await supervisor.agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'closed', version: ticket.version });

    expect(response.status).toBe(200);
    expect(response.body.outstandingTasks).toBeUndefined();
  });

  it('does not report a task that is already complete', async () => {
    const { supervisor, ticket } = await resolvedTicket();

    const created = await supervisor.agent
      .post('/api/tasks')
      .send({ title: 'Already handled', ticketId: ticket.id });
    await supervisor.agent.post(`/api/tasks/${created.body.id}/complete`);

    const response = await supervisor.agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'closed', version: ticket.version });

    expect(response.body.outstandingTasks).toBeUndefined();
  });

  it('reports another user’s outstanding task too', async () => {
    // Deliberately not scoped to the closer: closing a ticket with somebody
    // else's follow-up still open is exactly the case worth surfacing.
    const { supervisor, ticket } = await resolvedTicket();
    const agent = await agentAs('agent');

    await agent.agent
      .post('/api/tasks')
      .send({ title: 'Owed by someone else', ticketId: ticket.id });

    const response = await supervisor.agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'closed', version: ticket.version });

    expect(response.body.outstandingTasks).toHaveLength(1);
  });
});
