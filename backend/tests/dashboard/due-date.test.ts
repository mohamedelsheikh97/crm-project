import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Ticket } from '../../src/models/index.js';
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

/** MySQL DATETIME is second-precision, and the service truncates to match. */
function at(offsetMs: number): Date {
  const date = new Date(Date.now() + offsetMs);
  date.setMilliseconds(0);
  return date;
}

async function ticketFor(assignTo?: { id: number }) {
  const { user, agent } = await agentAs('agent');
  const customer = await seedCustomer();
  const ticket = await seedTicket({
    customer,
    createdBy: user,
    assignee: assignTo ? ({ id: assignTo.id } as never) : user,
    status: 'open',
  });

  return { user, agent, ticket };
}

describe('PUT /api/tickets/:id/due-date', () => {
  it('sets a due date and records it in the ticket history (FR-022)', async () => {
    const { agent, ticket } = await ticketFor();
    const dueAt = at(24 * HOUR);

    const response = await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: dueAt.toISOString(), version: ticket.version });

    expect(response.status).toBe(200);

    await ticket.reload();
    expect(ticket.due_at?.toISOString()).toBe(dueAt.toISOString());

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const entry = history.body.items.find(
      (item: { event: string }) => item.event === 'ticket.due_date.set',
    );

    expect(entry).toBeDefined();
    expect(entry.field).toBe('dueAt');
    expect(entry.previousValue).toBeNull();
    expect(entry.newValue).toBe(dueAt.toISOString());
  });

  it('distinguishes setting, changing, and clearing in the history', async () => {
    // Three events rather than one, because "someone put a date on this",
    // "someone moved it", and "someone took it off" read differently to whoever
    // is catching up on the ticket.
    const { agent, ticket } = await ticketFor();
    const first = at(24 * HOUR);
    const second = at(48 * HOUR);

    await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: first.toISOString(), version: ticket.version });
    await ticket.reload();

    await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: second.toISOString(), version: ticket.version });
    await ticket.reload();

    await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: null, version: ticket.version });

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const events = history.body.items.map((item: { event: string }) => item.event);

    expect(events).toContain('ticket.due_date.set');
    expect(events).toContain('ticket.due_date.changed');
    expect(events).toContain('ticket.due_date.cleared');
  });

  it('accepts a date already in the past (FR-024)', async () => {
    // Backdating a commitment that was already missed is legitimate — often it
    // is the whole reason someone is setting a date. Refusing it would force
    // the user to lie about when the work was due.
    const { agent, ticket } = await ticketFor();
    const past = at(-48 * HOUR);

    const response = await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: past.toISOString(), version: ticket.version });

    expect(response.status).toBe(200);

    const queue = await agent.get('/api/dashboard/queue');
    expect(queue.body.items[0].isOverdue).toBe(true);
  });

  it('clears a due date, returning the ticket to having none (FR-026)', async () => {
    const { agent, ticket } = await ticketFor();

    await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: at(HOUR).toISOString(), version: ticket.version });
    await ticket.reload();

    const response = await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: null, version: ticket.version });

    expect(response.status).toBe(200);
    await ticket.reload();
    expect(ticket.due_at).toBeNull();
  });

  it('treats re-saving the same date as a no-op, writing no history entry', async () => {
    // The behaviour that makes FR-045 possible: an identical re-save must not
    // re-arm the approaching-due warning, so it must not touch the row at all.
    const { agent, ticket } = await ticketFor();
    const dueAt = at(24 * HOUR);

    await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: dueAt.toISOString(), version: ticket.version });
    await ticket.reload();

    await Ticket.update({ due_warning_sent_for: dueAt }, { where: { id: ticket.id } });

    await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: dueAt.toISOString(), version: ticket.version });

    await ticket.reload();
    // Still marked as warned — the re-save did not re-arm it.
    expect(ticket.due_warning_sent_for?.toISOString()).toBe(dueAt.toISOString());

    const history = await agent.get(`/api/tickets/${ticket.id}/history`);
    const dueEvents = history.body.items.filter((item: { event: string }) =>
      item.event.startsWith('ticket.due_date.'),
    );

    expect(dueEvents).toHaveLength(1);
  });

  it('re-arms the warning when the date genuinely changes', async () => {
    const { agent, ticket } = await ticketFor();
    const first = at(24 * HOUR);

    await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: first.toISOString(), version: ticket.version });
    await Ticket.update({ due_warning_sent_for: first }, { where: { id: ticket.id } });
    await ticket.reload();

    await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: at(72 * HOUR).toISOString(), version: ticket.version });

    await ticket.reload();
    expect(ticket.due_warning_sent_for).toBeNull();
  });

  it('rejects an unparseable date rather than silently clearing it', async () => {
    const { agent, ticket } = await ticketFor();

    const response = await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: 'next Tuesday-ish', version: ticket.version });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a stale version', async () => {
    const { agent, ticket } = await ticketFor();

    const response = await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: new Date().toISOString(), version: ticket.version + 5 });

    expect(response.status).toBe(409);
  });

  it('refuses a merged ticket', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();
    const survivor = await seedTicket({ customer, createdBy: user, assignee: user });
    const merged = await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      mergedInto: survivor,
    });

    const response = await agent
      .put(`/api/tickets/${merged.id}/due-date`)
      .send({ dueAt: new Date().toISOString(), version: merged.version });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TICKET_MERGED');
  });
});

describe('setting a due date is its own authority (FR-025, FR-075)', () => {
  it('refuses a role that may view the ticket but holds no set_due_date grant', async () => {
    // Reading a queue must never imply the authority to change what is late.
    // The grant is removed rather than a role invented, so this tests the real
    // enforcement path rather than a fixture.
    const { user, agent } = await agentAs('agent');
    const admin = await agentAs('admin');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: user, assignee: user, status: 'open' });

    const roles = await admin.agent.get('/api/admin/roles');
    const agentRole = roles.body.items.find((role: { key: string }) => role.key === 'agent');
    const remaining = agentRole.permissions.filter((key: string) => key !== 'tickets:set_due_date');

    await admin.agent
      .put(`/api/admin/roles/${agentRole.id}/permissions`)
      .send({ permissions: remaining, version: agentRole.version });

    // Still able to see it...
    expect((await agent.get(`/api/tickets/${ticket.id}`)).status).toBe(200);

    // ...and still refused when trying to change what is late.
    const response = await agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: new Date().toISOString(), version: ticket.version });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
