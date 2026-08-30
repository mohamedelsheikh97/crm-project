import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runScheduledSweeps } from '../src/lib/scheduler.js';
import { Notification, Task } from '../src/models/index.js';
import { seedCustomer } from './customers/helpers.js';
import { agentAs } from './helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from './helpers/database.js';
import { seedTicket } from './tickets/helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** MySQL DATETIME is second-precision, and the services truncate to match. */
function at(base: number, offsetMs: number): Date {
  const date = new Date(base + offsetMs);
  date.setMilliseconds(0);
  return date;
}

/**
 * The scheduler is driven DIRECTLY with a controlled clock. No test waits on a
 * timer, and none depends on the interval having been running — which is also
 * the property that makes the production sweeps correct across a restart.
 */
describe('approaching-due warnings (FR-045)', () => {
  async function assignedTicketDue(offsetMs: number, now: number) {
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({
      customer,
      createdBy: supervisor.user,
      assignee: assignee.user,
      status: 'open',
      dueAt: at(now, offsetMs),
    });

    return { assignee, ticket };
  }

  it('warns the assignee once when the ticket comes inside the lead time', async () => {
    const now = Date.now();
    // Default lead is 60 minutes; 30 minutes out is inside it.
    const { assignee, ticket } = await assignedTicketDue(30 * MINUTE, now);

    const result = await runScheduledSweeps(new Date(now));

    expect(result.dueWarnings).toBe(1);

    const notifications = await assignee.agent.get('/api/notifications');
    expect(notifications.body.total).toBe(1);
    expect(notifications.body.items[0].type).toBe('ticket.due_soon');
    expect(notifications.body.items[0].ticket.id).toBe(ticket.id);
    // System-generated: nobody caused it.
    expect(notifications.body.items[0].actor).toBeNull();
  });

  it('does not warn twice for the same due date', async () => {
    const now = Date.now();
    const { assignee } = await assignedTicketDue(30 * MINUTE, now);

    await runScheduledSweeps(new Date(now));
    await runScheduledSweeps(new Date(now + MINUTE));
    await runScheduledSweeps(new Date(now + 2 * MINUTE));

    expect((await assignee.agent.get('/api/notifications')).body.total).toBe(1);
  });

  it('does not re-fire when the same date is saved again', async () => {
    // The distinction `due_warning_sent_for` exists to make: a re-save is not a
    // reschedule, and pinging the agent again for it would be noise.
    const now = Date.now();
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();
    const dueAt = at(now, 30 * MINUTE);
    const ticket = await seedTicket({
      customer,
      createdBy: supervisor.user,
      assignee: assignee.user,
      status: 'open',
      dueAt,
    });

    await runScheduledSweeps(new Date(now));
    await ticket.reload();

    await supervisor.agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: dueAt.toISOString(), version: ticket.version });

    await runScheduledSweeps(new Date(now + MINUTE));

    expect((await assignee.agent.get('/api/notifications')).body.total).toBe(1);
  });

  it('arms a new warning when the date genuinely changes', async () => {
    const now = Date.now();
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({
      customer,
      createdBy: supervisor.user,
      assignee: assignee.user,
      status: 'open',
      dueAt: at(now, 30 * MINUTE),
    });

    await runScheduledSweeps(new Date(now));
    await ticket.reload();

    // Moved to a new time that is still inside the lead window.
    await supervisor.agent
      .put(`/api/tickets/${ticket.id}/due-date`)
      .send({ dueAt: at(now, 45 * MINUTE).toISOString(), version: ticket.version });

    await runScheduledSweeps(new Date(now + MINUTE));

    expect((await assignee.agent.get('/api/notifications')).body.total).toBe(2);
  });

  it('does not warn about a ticket that is still far from its due date', async () => {
    const now = Date.now();
    const { assignee } = await assignedTicketDue(8 * HOUR, now);

    const result = await runScheduledSweeps(new Date(now));

    expect(result.dueWarnings).toBe(0);
    expect((await assignee.agent.get('/api/notifications')).body.total).toBe(0);
  });

  it('never warns about a Closed ticket (FR-027)', async () => {
    const now = Date.now();
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();

    await seedTicket({
      customer,
      createdBy: supervisor.user,
      assignee: assignee.user,
      status: 'closed',
      dueAt: at(now, -2 * HOUR),
    });

    const result = await runScheduledSweeps(new Date(now));

    expect(result.dueWarnings).toBe(0);
  });

  it('never warns about a merged or unassigned ticket', async () => {
    const now = Date.now();
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();

    const survivor = await seedTicket({ customer, createdBy: supervisor.user });
    await seedTicket({
      customer,
      createdBy: supervisor.user,
      assignee: assignee.user,
      status: 'open',
      dueAt: at(now, 10 * MINUTE),
      mergedInto: survivor,
    });
    // Unassigned: there is nobody to warn. An unassigned ticket running late is
    // a supervision problem, and this phase has no supervision surface for it.
    await seedTicket({
      customer,
      createdBy: supervisor.user,
      assignee: null,
      status: 'open',
      dueAt: at(now, 10 * MINUTE),
    });

    expect((await runScheduledSweeps(new Date(now))).dueWarnings).toBe(0);
  });

  it('warns about a ticket that is already overdue', async () => {
    // "Inside the lead time" includes "past". A date that slipped by while the
    // process was down still deserves a warning.
    const now = Date.now();
    const { assignee } = await assignedTicketDue(-3 * HOUR, now);

    expect((await runScheduledSweeps(new Date(now))).dueWarnings).toBe(1);
    expect((await assignee.agent.get('/api/notifications')).body.total).toBe(1);
  });
});

describe('task reminders (FR-044, FR-063)', () => {
  it('fires a reminder once at its time', async () => {
    const now = Date.now();
    const owner = await agentAs('agent');

    await Task.create({
      owner_user_id: owner.user.id,
      title: 'Call the customer back',
      remind_at: at(now, -MINUTE),
    });

    expect((await runScheduledSweeps(new Date(now))).reminders).toBe(1);
    // A second sweep must not send it again.
    expect((await runScheduledSweeps(new Date(now + MINUTE))).reminders).toBe(0);

    const notifications = await owner.agent.get('/api/notifications');
    expect(notifications.body.total).toBe(1);
    expect(notifications.body.items[0].type).toBe('task.reminder');
    expect(notifications.body.items[0].actor).toBeNull();
  });

  it('still fires a reminder whose time passed while the process was down', async () => {
    // The single most important property of this sweep. The query has NO LOWER
    // BOUND on remind_at, so a reminder is not "missed" by the tick that should
    // have caught it — it is simply still outstanding on the next one. There is
    // no catch-up code path here to forget, because none is needed.
    const now = Date.now();
    const owner = await agentAs('agent');

    await Task.create({
      owner_user_id: owner.user.id,
      title: 'Promised on Thursday',
      remind_at: at(now, -72 * HOUR),
    });

    expect((await runScheduledSweeps(new Date(now))).reminders).toBe(1);
    expect((await owner.agent.get('/api/notifications')).body.total).toBe(1);
  });

  it('does not fire before its time', async () => {
    const now = Date.now();
    const owner = await agentAs('agent');

    await Task.create({
      owner_user_id: owner.user.id,
      title: 'Not yet',
      remind_at: at(now, HOUR),
    });

    expect((await runScheduledSweeps(new Date(now))).reminders).toBe(0);
  });

  it('does not remind about a completed task', async () => {
    const now = Date.now();
    const owner = await agentAs('agent');

    await Task.create({
      owner_user_id: owner.user.id,
      title: 'Already done',
      remind_at: at(now, -MINUTE),
      completed_at: at(now, -2 * MINUTE),
    });

    expect((await runScheduledSweeps(new Date(now))).reminders).toBe(0);
  });

  it('marks the task reminded in the same transaction as the notification', async () => {
    const now = Date.now();
    const owner = await agentAs('agent');

    const task = await Task.create({
      owner_user_id: owner.user.id,
      title: 'Atomic',
      remind_at: at(now, -MINUTE),
    });

    await runScheduledSweeps(new Date(now));
    await task.reload();

    expect(task.reminded_at).not.toBeNull();
    expect(await Notification.count({ where: { task_id: task.id } })).toBe(1);
  });
});
