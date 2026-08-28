import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog, Ticket, TicketLink } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
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

describe('linking related tickets (US6, FR-047)', () => {
  it('links two tickets and shows the relationship on both', async () => {
    const { user, agent } = await agentAs('agent');
    const first = await seedTicket({ createdBy: user, status: 'open' });
    const second = await seedTicket({ createdBy: user, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${first.id}/links`)
      .send({ linkedTicketId: second.id });

    expect(response.status).toBe(201);
    expect(response.body.links).toHaveLength(1);
    expect(response.body.links[0].ticket.id).toBe(second.id);

    // Symmetric: the relationship is a fact about each ticket, and a reader of
    // either one should see it without opening the other.
    const other = await agent.get(`/api/tickets/${second.id}`);
    expect(other.body.links).toHaveLength(1);
    expect(other.body.links[0].ticket.id).toBe(first.id);
  });

  it('stores exactly one row per pair', async () => {
    const { user, agent } = await agentAs('agent');
    const first = await seedTicket({ createdBy: user, status: 'open' });
    const second = await seedTicket({ createdBy: user, status: 'open' });

    await agent.post(`/api/tickets/${first.id}/links`).send({ linkedTicketId: second.id });

    // Storing both directions would double the rows and create the possibility
    // of the two halves disagreeing.
    expect(await TicketLink.count()).toBe(1);
  });

  it('refuses a duplicate in the SAME direction', async () => {
    const { user, agent } = await agentAs('agent');
    const first = await seedTicket({ createdBy: user, status: 'open' });
    const second = await seedTicket({ createdBy: user, status: 'open' });

    await agent.post(`/api/tickets/${first.id}/links`).send({ linkedTicketId: second.id });
    const response = await agent
      .post(`/api/tickets/${first.id}/links`)
      .send({ linkedTicketId: second.id });

    expect(response.status).toBe(400);
    expect(await TicketLink.count()).toBe(1);
  });

  it('refuses a duplicate in the REVERSE direction (FR-048)', async () => {
    const { user, agent } = await agentAs('agent');
    const first = await seedTicket({ createdBy: user, status: 'open' });
    const second = await seedTicket({ createdBy: user, status: 'open' });

    await agent.post(`/api/tickets/${first.id}/links`).send({ linkedTicketId: second.id });

    // Caught by the unique index on the normalised pair, not by an application
    // check that could be forgotten.
    const response = await agent
      .post(`/api/tickets/${second.id}/links`)
      .send({ linkedTicketId: first.id });

    expect(response.status).toBe(400);
    expect(await TicketLink.count()).toBe(1);
  });

  it('refuses a self-link', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/links`)
      .send({ linkedTicketId: ticket.id });

    expect(response.status).toBe(400);
  });

  it('refuses a target that does not exist', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/links`)
      .send({ linkedTicketId: 999999 });

    expect(response.status).toBe(404);
  });

  it('records the link on both timelines and in the audit log', async () => {
    const { user, agent } = await agentAs('agent');
    const first = await seedTicket({ createdBy: user, status: 'open' });
    const second = await seedTicket({ createdBy: user, status: 'open' });

    await agent.post(`/api/tickets/${first.id}/links`).send({ linkedTicketId: second.id });

    for (const id of [first.id, second.id]) {
      const history = await agent.get(`/api/tickets/${id}/history`);
      const events = history.body.items.map((item: { event: string }) => item.event);
      expect(events).toContain('ticket.linked');
    }

    expect(await AuditLog.count({ where: { action: 'ticket.linked' } })).toBe(1);
  });
});

describe('unlinking leaves both tickets otherwise untouched (FR-049)', () => {
  it('removes the relationship and nothing else', async () => {
    const { user, agent } = await agentAs('agent');
    const first = await seedTicket({
      createdBy: user,
      status: 'open',
      priority: 'high',
      assignee: user,
    });
    const second = await seedTicket({ createdBy: user, status: 'pending', priority: 'low' });

    await agent.post(`/api/tickets/${first.id}/links`).send({ linkedTicketId: second.id });

    const response = await agent.delete(`/api/tickets/${first.id}/links/${second.id}`);

    expect(response.status).toBe(200);
    expect(response.body.links).toHaveLength(0);

    // This is the whole difference between a link and a merge.
    const reloadedFirst = await Ticket.findByPk(first.id);
    const reloadedSecond = await Ticket.findByPk(second.id);

    expect(reloadedFirst?.status).toBe('open');
    expect(reloadedFirst?.priority).toBe('high');
    expect(reloadedFirst?.assignee_user_id).toBe(user.id);
    expect(reloadedFirst?.merged_into_ticket_id).toBeNull();

    expect(reloadedSecond?.status).toBe('pending');
    expect(reloadedSecond?.priority).toBe('low');
    expect(reloadedSecond?.merged_into_ticket_id).toBeNull();
  });

  it('unlinks from either side', async () => {
    const { user, agent } = await agentAs('agent');
    const first = await seedTicket({ createdBy: user, status: 'open' });
    const second = await seedTicket({ createdBy: user, status: 'open' });

    await agent.post(`/api/tickets/${first.id}/links`).send({ linkedTicketId: second.id });

    const response = await agent.delete(`/api/tickets/${second.id}/links/${first.id}`);

    expect(response.status).toBe(200);
    expect(await TicketLink.count()).toBe(0);
  });

  it('404s when no such link exists', async () => {
    const { user, agent } = await agentAs('agent');
    const first = await seedTicket({ createdBy: user, status: 'open' });
    const second = await seedTicket({ createdBy: user, status: 'open' });

    const response = await agent.delete(`/api/tickets/${first.id}/links/${second.id}`);

    expect(response.status).toBe(404);
  });

  it('audits the removal', async () => {
    const { user, agent } = await agentAs('agent');
    const first = await seedTicket({ createdBy: user, status: 'open' });
    const second = await seedTicket({ createdBy: user, status: 'open' });

    await agent.post(`/api/tickets/${first.id}/links`).send({ linkedTicketId: second.id });
    await agent.delete(`/api/tickets/${first.id}/links/${second.id}`);

    expect(await AuditLog.count({ where: { action: 'ticket.unlinked' } })).toBe(1);
  });
});
