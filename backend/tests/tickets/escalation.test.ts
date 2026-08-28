import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog, Ticket } from '../../src/models/index.js';
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

describe('escalation requires a reason (FR-029)', () => {
  it('refuses an escalation with no reason', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'escalated', version: ticket.version });

    // An escalation with no reason is a status nobody downstream can act on.
    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('reason');
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('open');
  });

  it('refuses a reason that is only whitespace', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'escalated', version: ticket.version, reason: '   ' });

    expect(response.status).toBe(400);
  });

  it('stores the reason on the ticket and in the history', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'escalated', version: ticket.version, reason: 'Customer threatened to leave.' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('escalated');
    expect(response.body.escalationReason).toBe('Customer threatened to leave.');

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const entry = history.body.items.find(
      (item: { event: string }) => item.event === 'ticket.escalated',
    );

    expect(entry.note).toBe('Customer threatened to leave.');
  });

  it('audits it under its own key', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'open' });

    await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'escalated', version: ticket.version, reason: 'Third recurrence this month.' });

    expect(await AuditLog.count({ where: { action: 'ticket.escalated' } })).toBe(1);
  });
});

describe('escalation is not a dead end (FR-030, FR-031)', () => {
  it('reaches Resolved directly', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({
      createdBy: user,
      assignee: user,
      status: 'escalated',
      escalationReason: 'Original reason',
    });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'resolved', version: ticket.version });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('resolved');
  });

  it('comes back down to Open, clearing the current reason', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({
      createdBy: user,
      assignee: user,
      status: 'escalated',
      escalationReason: 'Original reason',
    });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'open', version: ticket.version });

    expect(response.status).toBe(200);
    // The field describes what is true NOW. Every escalation ever made stays
    // in the history, which is where the record belongs.
    expect(response.body.escalationReason).toBeNull();

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const escalations = history.body.items.filter(
      (item: { event: string }) => item.event === 'ticket.deescalated',
    );

    expect(escalations).toHaveLength(1);
    expect(await AuditLog.count({ where: { action: 'ticket.deescalated' } })).toBe(1);
  });

  it('comes back down to Pending', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({
      createdBy: user,
      assignee: user,
      status: 'escalated',
      escalationReason: 'Original reason',
    });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'pending', version: ticket.version });

    expect(response.status).toBe(200);
  });
});

describe('escalated tickets are findable', () => {
  it('filters by the escalated status', async () => {
    const { user, agent } = await agentAs('agent');
    await seedTicket({ createdBy: user, status: 'escalated', escalationReason: 'A' });
    await seedTicket({ createdBy: user, status: 'open' });

    const response = await agent.get('/api/tickets?status=escalated');

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].status).toBe('escalated');
  });
});
