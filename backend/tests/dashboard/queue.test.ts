import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * The queue is "tickets assigned to this user" — nothing more exotic. These
 * tests pin the three things that make it a queue rather than a filtered list:
 * whose it is, what it leaves out, and who may look at someone else's.
 */
describe('GET /api/dashboard/queue — scoping', () => {
  it('shows the caller their own tickets and nobody else’s', async () => {
    const mine = await agentAs('agent');
    const theirs = await agentAs('agent');
    const customer = await seedCustomer();

    await seedTicket({ customer, createdBy: mine.user, assignee: mine.user, status: 'open' });
    await seedTicket({ customer, createdBy: mine.user, assignee: mine.user, status: 'pending' });
    await seedTicket({ customer, createdBy: mine.user, assignee: theirs.user, status: 'open' });
    // Unassigned. An agent cannot claim it (Phase 3 Clarifications Q3), so it
    // is nobody's queue until a supervisor directs it.
    await seedTicket({ customer, createdBy: mine.user, assignee: null, status: 'new' });

    const response = await mine.agent.get('/api/dashboard/queue');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.viewingUser.id).toBe(mine.user.id);
  });

  it('excludes Closed by default and includes it on request', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    await seedTicket({ customer, createdBy: user, assignee: user, status: 'open' });
    await seedTicket({ customer, createdBy: user, assignee: user, status: 'closed' });

    const byDefault = await agent.get('/api/dashboard/queue');
    expect(byDefault.body.total).toBe(1);

    // Reachable deliberately (FR-003) — hidden by default is not the same as
    // unreachable.
    const including = await agent.get('/api/dashboard/queue?includeClosed=true');
    expect(including.body.total).toBe(2);
  });

  it('always excludes merged tickets', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const survivor = await seedTicket({ customer, createdBy: user, assignee: user });
    await seedTicket({ customer, createdBy: user, assignee: user, mergedInto: survivor });

    // No opt-in exists, unlike Closed. A merged ticket is a redirect, and a
    // queue of redirects is not a queue (FR-004).
    const response = await agent.get('/api/dashboard/queue?includeClosed=true');

    expect(response.body.total).toBe(1);
    expect(response.body.items[0].id).toBe(survivor.id);
  });

  it('pages rather than returning everything', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    for (let index = 0; index < 5; index += 1) {
      await seedTicket({ customer, createdBy: user, assignee: user, status: 'open' });
    }

    const response = await agent.get('/api/dashboard/queue?pageSize=2&page=2');

    expect(response.body.items).toHaveLength(2);
    expect(response.body.page).toBe(2);
    expect(response.body.total).toBe(5);
  });
});

/**
 * dashboard:view_any is conditional — the route gate is dashboard:view, and the
 * service demands view_any only when `userId` names someone else. The
 * permission matrix cannot express that, which is why it defers here
 * (authorization.matrix.test.ts, CONDITIONAL_PERMISSIONS).
 */
describe('GET /api/dashboard/queue — viewing another user’s queue (FR-010)', () => {
  it('refuses an agent asking for someone else’s queue', async () => {
    const mine = await agentAs('agent');
    const theirs = await agentAs('agent');
    const customer = await seedCustomer();

    await seedTicket({ customer, createdBy: mine.user, assignee: theirs.user, status: 'open' });

    const response = await mine.agent.get(`/api/dashboard/queue?userId=${theirs.user.id}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a supervisor, and says whose queue is being shown', async () => {
    const supervisor = await agentAs('supervisor');
    const agent = await agentAs('agent');
    const customer = await seedCustomer();

    await seedTicket({ customer, createdBy: agent.user, assignee: agent.user, status: 'open' });

    const response = await supervisor.agent.get(`/api/dashboard/queue?userId=${agent.user.id}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    // FR-011: the interface must be able to say whose queue this is.
    expect(response.body.viewingUser).toEqual({
      id: agent.user.id,
      fullName: agent.user.full_name,
    });
  });

  it('lets any user name themselves explicitly', async () => {
    // Naming yourself is the same request as omitting the parameter, so it must
    // not need view_any.
    const { user, agent } = await agentAs('agent');

    const response = await agent.get(`/api/dashboard/queue?userId=${user.id}`);

    expect(response.status).toBe(200);
  });

  it('treats an unparseable userId as "my queue" rather than someone else’s', async () => {
    const { user, agent } = await agentAs('agent');

    const response = await agent.get('/api/dashboard/queue?userId=not-a-number');

    expect(response.status).toBe(200);
    expect(response.body.viewingUser.id).toBe(user.id);
  });

  it('404s for a user that does not exist', async () => {
    const supervisor = await agentAs('supervisor');

    const response = await supervisor.agent.get('/api/dashboard/queue?userId=999999');

    expect(response.status).toBe(404);
  });
});
