import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import supertest from 'supertest';

import app from '../../src/app.js';
import { Role, RolePermission, TicketHistory } from '../../src/models/index.js';
import { agentAs, agentFor, createTestUser, signInAs } from '../helpers/auth.js';
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

describe('ticket history (US5)', () => {
  it('reads oldest first (FR-035)', async () => {
    const { user, agent } = await agentAs('supervisor');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'new' });

    await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'open', version: ticket.version });

    const reloaded = await agent.get(`/api/tickets/${ticket.id}`);

    await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'resolved', version: reloaded.body.version });

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const events = history.body.items.map((item: { event: string }) => item.event);

    // The opposite of the audit log and of customer notes, and deliberately
    // so: those are scanned for the latest event, this is read from the
    // beginning to understand what happened.
    expect(events[0]).toBe('ticket.status.changed');
    expect(history.body.items[0].newValue).toBe('open');
    expect(history.body.items[1].newValue).toBe('resolved');
  });

  it('orders same-second events by id', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, status: 'open' });

    // Written directly and in one go, so they land in the same second — the
    // condition that made Phase 2's notes appear randomly shuffled.
    for (let index = 0; index < 5; index += 1) {
      await TicketHistory.create({
        ticket_id: ticket.id,
        event: 'ticket.updated',
        actor_user_id: user.id,
        actor_name: 'Test User',
        field: 'subject',
        previous_value: String(index),
        new_value: String(index + 1),
      });
    }

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const ids = history.body.items.map((item: { id: number }) => item.id);

    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('carries previous and new values (FR-033)', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, status: 'open', priority: 'low' });

    await agent
      .patch(`/api/tickets/${ticket.id}`)
      .send({ priority: 'urgent', version: ticket.version });

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const entry = history.body.items.find((item: { field: string }) => item.field === 'priority');

    expect(entry.previousValue).toBe('low');
    expect(entry.newValue).toBe('urgent');
  });

  it('stays attributed after the actor is deactivated (FR-038)', async () => {
    const author = await createTestUser({ roleKey: 'agent', fullName: 'Departed Colleague' });
    const authorAgent = agentFor(await signInAs(author));
    const ticket = await seedTicket({ createdBy: author, status: 'open' });

    await authorAgent
      .patch(`/api/tickets/${ticket.id}`)
      .send({ subject: 'Edited before leaving', version: ticket.version });

    const { agent: admin } = await agentAs('admin');
    await admin.post(`/api/admin/users/${author.id}/deactivate`);

    const history = await admin.get(`/api/tickets/${ticket.id}/history`);
    const entry = history.body.items.find(
      (item: { event: string }) => item.event === 'ticket.updated',
    );

    // The name is snapshotted at write time; it is not a join that goes blank
    // when the account does.
    expect(entry.actorName).toBe('Departed Colleague');
  });

  it('is readable with tickets:view and does NOT require audit:view (FR-037)', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, status: 'open' });

    const role = await Role.findOne({ where: { key: 'agent' } });
    const holdsAudit = await RolePermission.findOne({
      where: { role_id: role!.id, permission_key: 'audit:view' },
    });

    // An Agent does not hold audit:view — that is the premise of the test.
    expect(holdsAudit).toBeNull();

    // Make a real change first: seedTicket writes the row directly, so a
    // freshly seeded ticket has no history and the assertion below would pass
    // vacuously on an empty page.
    await agent.patch(`/api/tickets/${ticket.id}`).send({
      subject: 'Edited so there is something to read',
      version: ticket.version,
    });

    const response = await agent.get(`/api/tickets/${ticket.id}/history`);

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);

    // And the audit log stays out of reach, which is the contrast the
    // requirement is actually about.
    expect((await agent.get('/api/admin/audit')).status).toBe(403);
  });

  it('has no write endpoint at any method (FR-034)', async () => {
    const { user, agent } = await agentAs('admin');
    const ticket = await seedTicket({ createdBy: user, status: 'open' });

    const post = await agent.post(`/api/tickets/${ticket.id}/history`).send({ event: 'forged' });
    const patch = await agent.patch(`/api/tickets/${ticket.id}/history`).send({});
    const remove = await agent.delete(`/api/tickets/${ticket.id}/history`);

    for (const response of [post, patch, remove]) {
      expect(response.status).toBe(404);
    }
  });

  it('redacts a credential a careless caller puts in a note (FR-039)', async () => {
    const { user, agent } = await agentAs('supervisor');
    const survivor = await seedTicket({ createdBy: user, status: 'open' });
    const absorbed = await seedTicket({ createdBy: user, status: 'open' });

    await agent.post(`/api/tickets/${absorbed.id}/merge`).send({
      intoTicketId: survivor.id,
      version: absorbed.version,
      note: 'Duplicate of the outage report.',
    });

    const rows = await TicketHistory.findAll({ where: { event: 'ticket.merged' } });
    expect(rows[0].note).toBe('Duplicate of the outage report.');
  });

  it('requires authentication like every other ticket route', async () => {
    const { user } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user, status: 'open' });

    const response = await supertest(app).get(`/api/tickets/${ticket.id}/history`);

    expect(response.status).toBe(401);
  });

  it('404s for a ticket that does not exist rather than returning an empty page', async () => {
    const { agent } = await agentAs('agent');

    const response = await agent.get('/api/tickets/999999/history');

    expect(response.status).toBe(404);
  });
});
