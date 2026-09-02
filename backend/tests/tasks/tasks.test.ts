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

const HOUR = 3_600_000;

function at(offsetMs: number): string {
  const date = new Date(Date.now() + offsetMs);
  date.setMilliseconds(0);
  return date.toISOString();
}

describe('tasks are personal (Clarifications Q3)', () => {
  it('takes the owner from the session, never the payload', async () => {
    const me = await agentAs('agent');

    const response = await me.agent.post('/api/tasks').send({ title: 'Call back Thursday' });

    expect(response.status).toBe(201);

    const task = await Task.findByPk(response.body.id);
    expect(task?.owner_user_id).toBe(me.user.id);
  });

  it('rejects an attempt to give someone else a task, rather than silently ignoring it', async () => {
    // Failing loudly matters here. Silently reassigning the task to the caller
    // would leave them believing they had delegated something.
    const me = await agentAs('agent');
    const other = await agentAs('agent');

    const response = await me.agent
      .post('/api/tasks')
      .send({ title: 'Not yours to give', ownerUserId: other.user.id });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Task.count()).toBe(0);
  });

  it('lists only the caller’s own tasks', async () => {
    const me = await agentAs('agent');
    const other = await agentAs('agent');

    await me.agent.post('/api/tasks').send({ title: 'Mine' });
    await other.agent.post('/api/tasks').send({ title: 'Theirs' });

    const response = await me.agent.get('/api/tasks');

    expect(response.body.total).toBe(1);
    expect(response.body.items[0].title).toBe('Mine');
  });

  it('404s on another user’s task for every mutating route', async () => {
    const me = await agentAs('agent');
    const other = await agentAs('agent');

    const created = await other.agent.post('/api/tasks').send({ title: 'Theirs' });
    const id = created.body.id;

    expect((await me.agent.patch(`/api/tasks/${id}`).send({ title: 'Hijacked' })).status).toBe(404);
    expect((await me.agent.post(`/api/tasks/${id}/complete`)).status).toBe(404);
    expect((await me.agent.post(`/api/tasks/${id}/reopen`)).status).toBe(404);
  });
});

describe('a task is about one thing (FR-056)', () => {
  it('links to a ticket', async () => {
    const me = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: me.user, assignee: me.user });

    const response = await me.agent
      .post('/api/tasks')
      .send({ title: 'Chase this', ticketId: ticket.id });

    expect(response.body.ticket.id).toBe(ticket.id);
    expect(response.body.customer).toBeNull();
  });

  it('links to a customer', async () => {
    const me = await agentAs('agent');
    const customer = await seedCustomer();

    const response = await me.agent
      .post('/api/tasks')
      .send({ title: 'Quarterly check-in', customerId: customer.id });

    expect(response.body.customer.id).toBe(customer.id);
    expect(response.body.ticket).toBeNull();
  });

  it('refuses both links at once', async () => {
    const me = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: me.user });

    const response = await me.agent
      .post('/api/tasks')
      .send({ title: 'Ambiguous', ticketId: ticket.id, customerId: customer.id });

    expect(response.status).toBe(400);
  });

  it('refuses a link to something that does not exist', async () => {
    const me = await agentAs('agent');

    expect(
      (await me.agent.post('/api/tasks').send({ title: 'Nowhere', ticketId: 999999 })).status,
    ).toBe(400);
  });

  it('allows a task with no link at all', async () => {
    const me = await agentAs('agent');

    const response = await me.agent.post('/api/tasks').send({ title: 'Just a reminder' });

    expect(response.status).toBe(201);
    expect(response.body.ticket).toBeNull();
    expect(response.body.customer).toBeNull();
  });
});

describe('completing and reopening (FR-059, FR-060)', () => {
  it('records completion and removes it from the outstanding list without deleting it', async () => {
    const me = await agentAs('agent');
    const created = await me.agent.post('/api/tasks').send({ title: 'Done shortly' });

    const completed = await me.agent.post(`/api/tasks/${created.body.id}/complete`);

    expect(completed.body.completedAt).not.toBeNull();
    expect((await me.agent.get('/api/tasks')).body.total).toBe(0);
    // Still a row — the commitment stays part of the record.
    expect(await Task.count()).toBe(1);
    expect((await me.agent.get('/api/tasks?status=completed')).body.total).toBe(1);
  });

  it('reopens a completed task', async () => {
    const me = await agentAs('agent');
    const created = await me.agent.post('/api/tasks').send({ title: 'Not actually done' });

    await me.agent.post(`/api/tasks/${created.body.id}/complete`);
    const reopened = await me.agent.post(`/api/tasks/${created.body.id}/reopen`);

    expect(reopened.body.completedAt).toBeNull();
    expect((await me.agent.get('/api/tasks')).body.total).toBe(1);
  });

  it('offers no delete route', async () => {
    const me = await agentAs('agent');
    const created = await me.agent.post('/api/tasks').send({ title: 'Permanent' });

    expect((await me.agent.delete(`/api/tasks/${created.body.id}`)).status).toBe(404);
  });
});

describe('due dates and reminders on tasks', () => {
  it('marks an overdue task, and stops once it is completed', async () => {
    const me = await agentAs('agent');
    const created = await me.agent.post('/api/tasks').send({ title: 'Late', dueAt: at(-2 * HOUR) });

    expect(created.body.isOverdue).toBe(true);

    const completed = await me.agent.post(`/api/tasks/${created.body.id}/complete`);
    // The commitment was kept, however late. Continuing to flag it would be
    // scolding rather than informing.
    expect(completed.body.isOverdue).toBe(false);
  });

  it('re-arms the reminder when its time changes (FR-062)', async () => {
    const me = await agentAs('agent');
    const created = await me.agent.post('/api/tasks').send({ title: 'Moved', remindAt: at(HOUR) });

    await Task.update({ reminded_at: new Date() }, { where: { id: created.body.id } });

    await me.agent.patch(`/api/tasks/${created.body.id}`).send({ remindAt: at(3 * HOUR) });

    const task = await Task.findByPk(created.body.id);
    // Without this, moving a reminder that had already fired would mean it
    // silently never fires again.
    expect(task?.reminded_at).toBeNull();
  });

  it('cancels a pending reminder when it is cleared', async () => {
    const me = await agentAs('agent');
    const created = await me.agent
      .post('/api/tasks')
      .send({ title: 'Never mind', remindAt: at(HOUR) });

    await me.agent.patch(`/api/tasks/${created.body.id}`).send({ remindAt: null });

    const task = await Task.findByPk(created.body.id);
    expect(task?.remind_at).toBeNull();
  });

  it('orders outstanding tasks soonest-due first, with undated ones last', async () => {
    const me = await agentAs('agent');

    await me.agent.post('/api/tasks').send({ title: 'Undated' });
    await me.agent.post('/api/tasks').send({ title: 'Later', dueAt: at(48 * HOUR) });
    await me.agent.post('/api/tasks').send({ title: 'Soon', dueAt: at(HOUR) });

    const response = await me.agent.get('/api/tasks');

    expect(response.body.items.map((task: { title: string }) => task.title)).toEqual([
      'Soon',
      'Later',
      'Undated',
    ]);
  });

  it('refuses an unparseable date', async () => {
    const me = await agentAs('agent');

    const response = await me.agent
      .post('/api/tasks')
      .send({ title: 'When?', dueAt: 'sometime soon' });

    expect(response.status).toBe(400);
  });
});
