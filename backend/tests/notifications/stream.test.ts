import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import * as hub from '../../src/lib/notification-hub.js';
import { agentAs, createTestUser, signInAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

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
 * What is and is not tested here, stated plainly (research D10.5).
 *
 * TESTED: the hub's routing and cleanup, and that the stream route is an
 * ordinary authenticated route with the right headers.
 *
 * NOT TESTED: a held streaming connection driven end to end. supertest resolves
 * on response completion, and this response deliberately never completes.
 *
 * That gap is acceptable because of the ordering rule the whole design rests
 * on: the notification is a ROW first. Delivery over the stream is an
 * optimisation whose failure mode — a dropped connection — is covered by the
 * `?since=` catch-up path in notifications.test.ts. If the stream never worked
 * at all, every notification would still arrive (FR-047, SC-010).
 */
describe('the notification hub', () => {
  it('delivers only to the intended recipient', async () => {
    const delivered: Array<Record<string, unknown>> = [];
    const wrongInbox: Array<Record<string, unknown>> = [];

    const stopA = hub.subscribe(1, (payload) => delivered.push(payload));
    const stopB = hub.subscribe(2, (payload) => wrongInbox.push(payload));

    hub.publish(1, { id: 10, type: 'ticket.assigned' });

    expect(delivered).toHaveLength(1);
    expect(wrongInbox).toHaveLength(0);

    stopA();
    stopB();
  });

  it('publishes harmlessly when nobody is listening', () => {
    // An offline recipient is the normal case, not an error. Their notification
    // is already a row and will be waiting at next sign-in.
    expect(() => hub.publish(999, { id: 1, type: 'task.reminder' })).not.toThrow();
  });

  it('detaches its listener, so reconnects do not accumulate them', () => {
    // A stream route that fails to unsubscribe on close leaks one listener per
    // reconnect — and reconnects are routine by design.
    const before = hub.listenerCount(42);

    const stop = hub.subscribe(42, () => {});
    expect(hub.listenerCount(42)).toBe(before + 1);

    stop();
    expect(hub.listenerCount(42)).toBe(before);
  });

  it('supports several concurrent connections for the same user', () => {
    // The same person signed in on a laptop and a phone. Both must see it.
    const seen: number[] = [];

    const stopA = hub.subscribe(7, () => seen.push(1));
    const stopB = hub.subscribe(7, () => seen.push(2));

    hub.publish(7, { id: 5, type: 'note.mentioned' });

    expect(seen).toHaveLength(2);

    stopA();
    stopB();
  });
});

describe('GET /api/notifications/stream', () => {
  it('refuses an unauthenticated request like every other protected route', async () => {
    const response = await supertest(app).get('/api/notifications/stream');

    expect(response.status).toBe(401);
  });

  it('refuses an invalid token', async () => {
    const response = await supertest(app)
      .get('/api/notifications/stream')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
  });

  it('refuses a deactivated user', async () => {
    // The stream is a long-lived connection, so it matters that it is gated by
    // the same per-request user reload every other route uses rather than by
    // the token alone.
    const admin = await agentAs('admin');
    const user = await createTestUser({ roleKey: 'agent' });
    const token = await signInAs(user);

    await admin.agent.post(`/api/admin/users/${user.id}/deactivate`);

    const response = await supertest(app)
      .get('/api/notifications/stream')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('is reached with the Authorization header, not a token in the URL', async () => {
    // The reason the client uses fetch() + ReadableStream instead of
    // EventSource: EventSource cannot set this header, and putting the access
    // token in the query string would write a credential into pino-http's URL
    // log (research D1).
    const response = await supertest(app).get('/api/notifications/stream?token=leaked');

    expect(response.status).toBe(401);
  });
});
