import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Notification, Task } from '../src/models/index.js';
import { agentAs } from './helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from './helpers/database.js';

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
 * Ownership isolation for user-scoped records (SC-012, FR-051, FR-076).
 *
 * Phase 4 introduces the first records in this project whose reader is decided
 * by WHO OWNS THEM rather than by which role you hold. The permission matrix
 * cannot cover that: two agents hold identical permissions, and the whole point
 * is that one of them still cannot read the other's notifications.
 *
 * GENERATED over the record types rather than hand-written per endpoint, so a
 * future user-scoped record cannot be added without a test. Adding an entry to
 * SCOPED_RECORDS below is the only work a new record type needs.
 *
 * ON 404 RATHER THAN 403: whether someone else's task exists is itself not the
 * caller's business. A 403 would confirm the record is real, which is a small
 * leak that costs nothing to avoid. Every assertion below is therefore for 404,
 * and a 403 fails the test just as loudly as a 200 would.
 */
interface ScopedRecord {
  label: string;
  /** Creates a record owned by the given user and returns its id. */
  create: (ownerUserId: number, otherUserId: number) => Promise<number>;
  /** Every route that reads or mutates one record by id. */
  routes: Array<{
    method: 'get' | 'post' | 'patch' | 'put' | 'delete';
    path: (id: number) => string;
  }>;
}

const SCOPED_RECORDS: ScopedRecord[] = [
  {
    label: 'notification',
    create: async (ownerUserId, otherUserId) => {
      const notification = await Notification.create({
        user_id: ownerUserId,
        type: 'ticket.assigned',
        actor_user_id: otherUserId,
      });

      return notification.id;
    },
    routes: [{ method: 'post', path: (id) => `/api/notifications/${id}/read` }],
  },
  {
    label: 'task',
    create: async (ownerUserId) => {
      const task = await Task.create({
        owner_user_id: ownerUserId,
        title: 'A commitment belonging to someone else',
      });

      return task.id;
    },
    routes: [
      { method: 'patch', path: (id) => `/api/tasks/${id}` },
      { method: 'post', path: (id) => `/api/tasks/${id}/complete` },
      { method: 'post', path: (id) => `/api/tasks/${id}/reopen` },
    ],
  },
];

describe('ownership isolation (SC-012)', () => {
  it.each(
    SCOPED_RECORDS.flatMap((record) =>
      record.routes.map((route) => ({
        label: record.label,
        record,
        route,
        description: `${route.method.toUpperCase()} ${route.path(0).replace('/0', '/:id')}`,
      })),
    ),
  )("$label: another user's record is invisible to $description", async ({ record, route }) => {
    const owner = await agentAs('agent');
    const intruder = await agentAs('agent');

    const id = await record.create(owner.user.id, intruder.user.id);

    const response = await intruder.agent[route.method](route.path(id)).send({});

    // 404, never 403 — see the file comment.
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('a list returns only the caller’s own records', async () => {
    const owner = await agentAs('agent');
    const intruder = await agentAs('agent');

    await Notification.create({
      user_id: owner.user.id,
      type: 'ticket.assigned',
      actor_user_id: intruder.user.id,
    });
    await Task.create({ owner_user_id: owner.user.id, title: 'Not yours' });

    // A list is the other way a scoped record leaks: not by id, but by being
    // included in someone else's page.
    const notifications = await intruder.agent.get('/api/notifications');
    expect(notifications.status).toBe(200);
    expect(notifications.body.items).toEqual([]);
    expect(notifications.body.unreadCount).toBe(0);

    const tasks = await intruder.agent.get('/api/tasks');
    expect(tasks.status).toBe(200);
    expect(tasks.body.items).toEqual([]);
  });

  it('a supervisor cannot read another user’s notifications or tasks either', async () => {
    // dashboard:view_any is about someone else's QUEUE — the tickets assigned
    // to them, which are shared work. It is deliberately not a master key for
    // their private notifications and personal tasks (FR-076).
    const owner = await agentAs('agent');
    const supervisor = await agentAs('supervisor');

    await Notification.create({
      user_id: owner.user.id,
      type: 'task.reminder',
      actor_user_id: null,
    });
    await Task.create({ owner_user_id: owner.user.id, title: 'Personal follow-up' });

    const notifications = await supervisor.agent.get('/api/notifications');
    expect(notifications.body.items).toEqual([]);

    const tasks = await supervisor.agent.get('/api/tasks');
    expect(tasks.body.items).toEqual([]);
  });

  it('every user-scoped record type has at least one route probe', () => {
    // Exempt and untested is the failure this prevents, exactly as the
    // permission matrix guards against a key with no probe.
    for (const record of SCOPED_RECORDS) {
      expect(record.routes.length).toBeGreaterThan(0);
    }
  });
});
