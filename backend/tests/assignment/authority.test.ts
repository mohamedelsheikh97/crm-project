import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Role, RolePermission } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
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
 * FR-051, and the condition the permission matrix cannot express.
 *
 * Configuring automatic assignment is SELF-ASSIGNMENT BY A LONGER ROUTE. Phase 3
 * Clarifications Q3 fixed assignment as Supervisor-only and Phase 4 honoured it;
 * an agent who could choose the routing strategy could route work to themselves
 * without ever touching a ticket.
 *
 * The seeder does not grant `assignment:manage` to Agent — but a permission
 * catalog is EDITABLE, and an administrator can grant it by mistake from the
 * roles screen. So the authority is enforced a second time in the service,
 * against `tickets:assign`, and this is the test of that second check. The
 * matrix test covers the route gate and names this file for the condition.
 */
describe('configuring assignment requires the Phase 3 assignment authority (FR-051)', () => {
  it('refuses an Agent by route gate alone', async () => {
    const { agent } = await agentAs('agent');

    const response = await agent.get('/api/admin/assignment');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('STILL refuses an Agent granted assignment:manage by misconfiguration', async () => {
    const role = await Role.findOne({ where: { key: 'agent' } });

    // The mistake this guards against: somebody adds the key on the roles
    // screen without realising what it implies.
    await RolePermission.create({
      role_id: role!.id,
      permission_key: 'assignment:manage',
    });

    const { agent } = await agentAs('agent');

    // The route now lets them through...
    const read = await agent.get('/api/admin/assignment');
    expect(read.status).toBe(200);

    // ...and the SERVICE refuses the write, because they do not hold
    // `tickets:assign`. Reading who is eligible is harmless; deciding where
    // work goes is the supervisory act.
    const write = await agent.patch('/api/admin/assignment').send({
      strategy: 'round_robin',
      version: read.body.version,
    });

    expect(write.status).toBe(403);
    expect(write.body.error.details?.[0]?.message).toBe('assignment.error.requiresAssignAuthority');
  });

  it('refuses the same Agent the competency screen, which routes work too', async () => {
    const role = await Role.findOne({ where: { key: 'agent' } });

    await RolePermission.create({
      role_id: role!.id,
      permission_key: 'assignment:manage',
    });

    const { agent, user } = await agentAs('agent');

    const response = await agent
      .put(`/api/admin/assignment/competencies/${user.id}`)
      .send({ categories: ['billing'] });

    // Competency IS routing (research D14), which is why one permission covers
    // both — and why the same second check applies to both.
    expect(response.status).toBe(403);
  });

  it('allows a Supervisor, who holds tickets:assign', async () => {
    const { agent } = await agentAs('supervisor');
    const role = await Role.findOne({ where: { key: 'supervisor' } });

    await RolePermission.create({
      role_id: role!.id,
      permission_key: 'assignment:manage',
    });

    const read = await agent.get('/api/admin/assignment');
    expect(read.status).toBe(200);

    const write = await agent.patch('/api/admin/assignment').send({
      strategy: 'least_loaded',
      version: read.body.version,
    });

    expect(write.status).toBe(200);
    expect(write.body.strategy).toBe('least_loaded');
  });

  it('reports the eligible-agent count so zero is visible while choosing', async () => {
    const { agent } = await agentAs('admin');

    const response = await agent.get('/api/admin/assignment');

    expect(response.status).toBe(200);
    // User Story 3 scenario 3: a strategy configured against nobody is the
    // failure to surface WHERE THE CHOICE IS MADE, not at 02:00.
    expect(typeof response.body.eligibleAgentCount).toBe('number');
    expect(response.body.eligibleAgentCount).toBeGreaterThanOrEqual(1);
  });
});
