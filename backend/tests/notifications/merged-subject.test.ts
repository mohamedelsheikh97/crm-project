import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Notification } from '../../src/models/index.js';
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
 * A notification must never lead somewhere unworkable (FR-052).
 *
 * The merge is resolved at READ time, not at write time — which is the only
 * possible choice, because the merge usually happens long after the
 * notification. A notification about a ticket merged away a week later must
 * still take the agent somewhere useful.
 */
describe('notifications about merged tickets', () => {
  it('points at the survivor rather than the ticket that was merged away', async () => {
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();

    const doomed = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });
    const survivor = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    // The notification is created while the ticket is perfectly normal.
    await supervisor.agent
      .put(`/api/tickets/${doomed.id}/assignee`)
      .send({ userId: assignee.user.id, version: doomed.version });

    await doomed.reload();
    await supervisor.agent
      .post(`/api/tickets/${doomed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: doomed.version });

    const response = await assignee.agent.get('/api/notifications');

    expect(response.body.items[0].ticket.id).toBe(survivor.id);
  });

  it('follows a chain of merges to the single surviving ticket', async () => {
    // Phase 3 guarantees merge chains resolve to one survivor rather than a
    // trail of redirects. This notification has to land on the same one.
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();

    const first = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });
    const middle = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });
    const survivor = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    await supervisor.agent
      .put(`/api/tickets/${first.id}/assignee`)
      .send({ userId: assignee.user.id, version: first.version });

    await first.reload();
    await supervisor.agent
      .post(`/api/tickets/${first.id}/merge`)
      .send({ intoTicketId: middle.id, version: first.version });

    await middle.reload();
    await supervisor.agent
      .post(`/api/tickets/${middle.id}/merge`)
      .send({ intoTicketId: survivor.id, version: middle.version });

    const response = await assignee.agent.get('/api/notifications');

    expect(response.body.items[0].ticket.id).toBe(survivor.id);
  });

  it('leaves an unmerged ticket exactly as it is', async () => {
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    await supervisor.agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: assignee.user.id, version: ticket.version });

    const response = await assignee.agent.get('/api/notifications');

    expect(response.body.items[0].ticket.id).toBe(ticket.id);
  });

  it('resolves the same way when marking a single notification read', async () => {
    // The read endpoint returns the notification too, so it must not disagree
    // with the list about where the notification leads.
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();

    const doomed = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });
    const survivor = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    await supervisor.agent
      .put(`/api/tickets/${doomed.id}/assignee`)
      .send({ userId: assignee.user.id, version: doomed.version });

    await doomed.reload();
    await supervisor.agent
      .post(`/api/tickets/${doomed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: doomed.version });

    const [notification] = await Notification.findAll();
    const response = await assignee.agent.post(`/api/notifications/${notification.id}/read`);

    expect(response.body.ticket.id).toBe(survivor.id);
  });
});
