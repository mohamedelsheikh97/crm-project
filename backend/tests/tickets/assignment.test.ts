import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog, Role, RolePermission, Ticket } from '../../src/models/index.js';
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

describe('assignment is Supervisor-only (Clarifications Q3)', () => {
  it('lets a Supervisor assign a ticket', async () => {
    const { user, agent } = await agentAs('supervisor');
    const target = await createTestUser({ roleKey: 'agent', fullName: 'Sara Ahmed' });
    const ticket = await seedTicket({ createdBy: user });

    const response = await agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: target.id, version: ticket.version });

    expect(response.status).toBe(200);
    expect(response.body.assignee.id).toBe(target.id);
    expect(response.body.assignee.fullName).toBe('Sara Ahmed');
  });

  it('refuses an Agent', async () => {
    const { user, agent } = await agentAs('agent');
    const target = await createTestUser({ roleKey: 'agent' });
    const ticket = await seedTicket({ createdBy: user });

    const response = await agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: target.id, version: ticket.version });

    expect(response.status).toBe(403);
  });

  it('refuses an Agent assigning to THEMSELVES', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user });

    const response = await agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: user.id, version: ticket.version });

    // There is no claim action. An unassigned ticket waits on a Supervisor,
    // which is why Phase 4's dashboard is read-only about assignment.
    expect(response.status).toBe(403);
    expect((await Ticket.findByPk(ticket.id))?.assignee_user_id).toBeNull();
  });
});

describe('reassignment and unassignment (FR-026, FR-028)', () => {
  it('reassigns at any time and records both sides', async () => {
    const { user, agent } = await agentAs('supervisor');
    const first = await createTestUser({ roleKey: 'agent', fullName: 'First Agent' });
    const second = await createTestUser({ roleKey: 'agent', fullName: 'Second Agent' });
    const ticket = await seedTicket({ createdBy: user, assignee: first });

    const response = await agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: second.id, version: ticket.version });

    expect(response.status).toBe(200);
    expect(response.body.assignee.id).toBe(second.id);

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const entry = history.body.items.find(
      (item: { event: string }) => item.event === 'ticket.assigned',
    );

    // Reassignment is only legible if the history says who it came FROM as
    // well as who it went to.
    expect(entry.previousValue).toBe('First Agent');
    expect(entry.newValue).toBe('Second Agent');
  });

  it('unassigns with a null userId', async () => {
    const { user, agent } = await agentAs('supervisor');
    const target = await createTestUser({ roleKey: 'agent' });
    const ticket = await seedTicket({ createdBy: user, assignee: target });

    const response = await agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: null, version: ticket.version });

    expect(response.status).toBe(200);
    expect(response.body.assignee).toBeNull();
    expect(await AuditLog.count({ where: { action: 'ticket.unassigned' } })).toBe(1);
  });
});

describe('the target must be able to do the work', () => {
  it('refuses a deactivated user', async () => {
    const { user, agent } = await agentAs('supervisor');
    const target = await createTestUser({ roleKey: 'agent', isActive: false });
    const ticket = await seedTicket({ createdBy: user });

    const response = await agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: target.id, version: ticket.version });

    expect(response.status).toBe(400);
  });

  it('refuses a user whose role cannot view tickets', async () => {
    const { user, agent } = await agentAs('supervisor');
    const target = await createTestUser({ roleKey: 'agent' });
    const ticket = await seedTicket({ createdBy: user });

    // Strip the grant so the target's role genuinely cannot open the ticket.
    const role = await Role.findOne({ where: { key: 'agent' } });
    await RolePermission.destroy({
      where: { role_id: role!.id, permission_key: 'tickets:view' },
    });

    const response = await agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: target.id, version: ticket.version });

    // Assigning work to someone who cannot open it is a silent dead end: the
    // ticket looks handled and nobody can handle it.
    expect(response.status).toBe(400);
  });

  it('refuses a user who does not exist', async () => {
    const { user, agent } = await agentAs('supervisor');
    const ticket = await seedTicket({ createdBy: user });

    const response = await agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: 999999, version: ticket.version });

    expect(response.status).toBe(400);
  });
});

describe('assignment respects optimistic locking', () => {
  it('refuses a stale version', async () => {
    const { user, agent } = await agentAs('supervisor');
    const target = await createTestUser({ roleKey: 'agent' });
    const ticket = await seedTicket({ createdBy: user });

    const response = await agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: target.id, version: ticket.version + 3 });

    expect(response.status).toBe(409);
  });
});
