import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import { Notification } from '../../src/models/index.js';
import * as notificationService from '../../src/services/notification.service.js';
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

describe('notifications are a row first and an event second (FR-047)', () => {
  it('persists a notification for an assignment and delivers it at next sign-in', async () => {
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    await supervisor.agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: assignee.user.id, version: ticket.version });

    // The assignee was never connected. The notification is waiting anyway —
    // this is the guarantee that lets the stream be a mere accelerant.
    const response = await assignee.agent.get('/api/notifications');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].type).toBe('ticket.assigned');
    expect(response.body.items[0].actor.id).toBe(supervisor.user.id);
    expect(response.body.items[0].ticket.id).toBe(ticket.id);
    expect(response.body.items[0].readAt).toBeNull();
    expect(response.body.unreadCount).toBe(1);
  });

  it('carries no rendered message, only a type and identifiers', async () => {
    // The structural guarantee behind Principle I on this surface: the same row
    // is read by an Arabic user and an English one, so the sentence cannot be
    // composed at write time. A `message` field appearing here would mean the
    // server had started deciding the language.
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    await supervisor.agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: assignee.user.id, version: ticket.version });

    const response = await assignee.agent.get('/api/notifications');
    const item = response.body.items[0];

    expect(item).not.toHaveProperty('message');
    expect(item).not.toHaveProperty('title');
    expect(item).not.toHaveProperty('body');
    expect(item.type).toBe('ticket.assigned');
  });

  it('never notifies a user of their own action (FR-053)', async () => {
    // A supervisor assigning a ticket to themselves is a normal thing to do,
    // and being pinged about it is not information.
    const supervisor = await agentAs('supervisor');
    const customer = await seedCustomer();
    const ticket = await seedTicket({ customer, createdBy: supervisor.user, status: 'open' });

    await supervisor.agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: supervisor.user.id, version: ticket.version });

    const response = await supervisor.agent.get('/api/notifications');

    expect(response.body.total).toBe(0);
  });

  it('does not notify on unassignment', async () => {
    const supervisor = await agentAs('supervisor');
    const assignee = await agentAs('agent');
    const customer = await seedCustomer();
    const ticket = await seedTicket({
      customer,
      createdBy: supervisor.user,
      assignee: assignee.user,
      status: 'open',
    });

    await supervisor.agent
      .put(`/api/tickets/${ticket.id}/assignee`)
      .send({ userId: null, version: ticket.version });

    // "This is no longer yours" is not news to push at someone mid-task.
    const response = await assignee.agent.get('/api/notifications');
    expect(response.body.total).toBe(0);
  });

  it('emits nothing when the surrounding transaction rolls back', async () => {
    // The ordering rule stated as a test: a notification emitted for work that
    // then rolled back would be a lie no catch-up query can fix.
    const recipient = await agentAs('agent');
    const actor = await agentAs('supervisor');

    await expect(
      sequelize.transaction(async (transaction) => {
        await notificationService.create(
          {
            userId: recipient.user.id,
            type: notificationService.NOTIFICATION_TYPES.TICKET_ASSIGNED,
            actorUserId: actor.user.id,
          },
          transaction,
        );

        throw new Error('rolled back on purpose');
      }),
    ).rejects.toThrow('rolled back on purpose');

    expect(await Notification.count()).toBe(0);
  });
});

describe('reading notifications', () => {
  async function seedNotifications(userId: number, actorId: number, count: number) {
    for (let index = 0; index < count; index += 1) {
      await Notification.create({
        user_id: userId,
        type: 'ticket.assigned',
        actor_user_id: actorId,
      });
    }
  }

  it('returns newest first, paged and bounded (FR-050)', async () => {
    const me = await agentAs('agent');
    const other = await agentAs('supervisor');

    await seedNotifications(me.user.id, other.user.id, 5);

    const response = await me.agent.get('/api/notifications?pageSize=2');

    expect(response.body.items).toHaveLength(2);
    expect(response.body.total).toBe(5);
    expect(response.body.items[0].id).toBeGreaterThan(response.body.items[1].id);
  });

  it('carries the unread count on every page so the badge needs no second request', async () => {
    const me = await agentAs('agent');
    const other = await agentAs('supervisor');

    await seedNotifications(me.user.id, other.user.id, 3);

    const page = await me.agent.get('/api/notifications?pageSize=1&page=2');
    expect(page.body.unreadCount).toBe(3);
  });

  it('filters to unread only', async () => {
    const me = await agentAs('agent');
    const other = await agentAs('supervisor');

    await seedNotifications(me.user.id, other.user.id, 2);
    const [first] = await Notification.findAll({ order: [['id', 'ASC']] });
    await me.agent.post(`/api/notifications/${first.id}/read`);

    const response = await me.agent.get('/api/notifications?unreadOnly=true');

    expect(response.body.total).toBe(1);
    expect(response.body.unreadCount).toBe(1);
  });

  it('returns everything newer than `since`, which is how a reconnect catches up', async () => {
    const me = await agentAs('agent');
    const other = await agentAs('supervisor');

    await seedNotifications(me.user.id, other.user.id, 2);
    const existing = await Notification.findAll({ order: [['id', 'ASC']] });
    const lastSeen = existing[existing.length - 1].id;

    await seedNotifications(me.user.id, other.user.id, 3);

    // The client asks this on every (re)connect, so a gap in the stream heals
    // itself without anyone noticing (FR-054, SC-010).
    const response = await me.agent.get(`/api/notifications?since=${lastSeen}`);

    expect(response.body.total).toBe(3);
  });

  it('marks one read, and all read', async () => {
    const me = await agentAs('agent');
    const other = await agentAs('supervisor');

    await seedNotifications(me.user.id, other.user.id, 3);
    const [first] = await Notification.findAll({ order: [['id', 'ASC']] });

    const one = await me.agent.post(`/api/notifications/${first.id}/read`);
    expect(one.status).toBe(200);
    expect(one.body.readAt).not.toBeNull();

    const all = await me.agent.post('/api/notifications/read-all');
    expect(all.body.unreadCount).toBe(0);

    expect((await me.agent.get('/api/notifications')).body.unreadCount).toBe(0);
  });

  it('404s for a notification belonging to someone else, never 403', async () => {
    // Whether a given notification exists is not the caller's business, and a
    // 403 would confirm it.
    const me = await agentAs('agent');
    const other = await agentAs('agent');

    await seedNotifications(other.user.id, me.user.id, 1);
    const [theirs] = await Notification.findAll();

    const response = await me.agent.post(`/api/notifications/${theirs.id}/read`);

    expect(response.status).toBe(404);
  });
});
