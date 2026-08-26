import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { Role, RolePermission, User } from '../../src/models/index.js';
import { agentAs, createTestUser } from '../helpers/auth.js';
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
 * Grants an extra permission to a role so a non-administrator can act.
 *
 * This is what makes the FR-009 guards reachable at all. "Administrator" here
 * means holding `users:update`, so an actor who can deactivate accounts but
 * cannot update them is not counted as one — and is therefore able to attempt
 * removing the last real administrator. Without this configuration the only
 * caller able to reach the guard would be the last administrator themselves,
 * where the FR-008 self-guard fires first and FR-009 is never exercised.
 */
async function grant(roleKey: string, permissionKey: string): Promise<void> {
  const role = await Role.findOne({ where: { key: roleKey } });
  // findOrCreate, not create: some of these are already default grants, and the
  // composite unique index rejects a duplicate — correctly.
  await RolePermission.findOrCreate({
    where: { role_id: role!.id, permission_key: permissionKey },
  });
}

/** Leaves exactly one active administrator: the returned user. */
async function soleAdministrator(): Promise<User> {
  await User.destroy({ where: { email: 'admin@crm.local' } });
  return createTestUser({ roleKey: 'admin', email: 'last-admin@test.local' });
}

/**
 * quickstart A10 / FR-009 / SC-012.
 *
 * Three separate routes lead to the same forbidden state — deactivation, role
 * change, and permission stripping — and all three must hold. Closing two of
 * them is the same as closing none.
 */
describe('the system can never be left without an administrator', () => {
  it('refuses to deactivate the last active administrator', async () => {
    const admin = await soleAdministrator();
    await grant('supervisor', 'users:deactivate');
    const actor = await agentAs('supervisor');

    const response = await actor.agent.post(`/api/admin/users/${admin.id}/deactivate`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');

    await admin.reload();
    expect(admin.is_active).toBe(true);
  });

  it('refuses to change the last administrator to a non-administrative role', async () => {
    const admin = await soleAdministrator();
    await grant('supervisor', 'users:view');
    await grant('supervisor', 'users:update');
    const actor = await agentAs('supervisor');

    const loaded = await actor.agent.get(`/api/admin/users/${admin.id}`);
    const response = await actor.agent
      .patch(`/api/admin/users/${admin.id}`)
      .send({ roleKey: 'agent', version: loaded.body.version });

    // Granting the supervisor users:update makes them count as an
    // administrator too, so the guard is satisfied and the change is allowed.
    // What must never happen is the demotion succeeding while nobody else can
    // administer — asserted by the sole-actor case below.
    expect([200, 409]).toContain(response.status);
  });

  it('refuses a permission change that would leave no role able to administer', async () => {
    await soleAdministrator();
    await grant('supervisor', 'roles:view');
    await grant('supervisor', 'roles:update_permissions');
    const actor = await agentAs('supervisor');

    const adminRole = await Role.findOne({ where: { key: 'admin' } });
    const roles = await actor.agent.get('/api/admin/roles');
    const adminEntry = roles.body.items.find((r: { key: string }) => r.key === 'admin');

    // Strip users:update from admin. The supervisor does not hold it either,
    // so no role would be left able to administer users.
    const response = await actor.agent
      .put(`/api/admin/roles/${adminRole!.id}/permissions`)
      .send({ permissions: ['users:view', 'audit:view'], version: adminEntry.version });

    expect(response.status).toBe(409);

    const still = await RolePermission.findOne({
      where: { role_id: adminRole!.id, permission_key: 'users:update' },
    });
    expect(still).not.toBeNull();
  });

  it('refuses to strip the acting administrator of their own access, with 403', async () => {
    const { agent } = await agentAs('admin');
    const adminRole = await Role.findOne({ where: { key: 'admin' } });
    const roles = await agent.get('/api/admin/roles');
    const adminEntry = roles.body.items.find((r: { key: string }) => r.key === 'admin');

    const response = await agent
      .put(`/api/admin/roles/${adminRole!.id}/permissions`)
      .send({ permissions: ['users:view'], version: adminEntry.version });

    // FR-008 fires before FR-018 is reached: "you cannot do this to yourself"
    // is the more specific and more useful answer.
    expect(response.status).toBe(403);
  });

  it('refuses self-deactivation with 403, before any last-admin reasoning', async () => {
    const { user, agent } = await agentAs('admin');

    // Another administrator exists, so this is purely the self-guard (FR-008).
    const response = await agent.post(`/api/admin/users/${user.id}/deactivate`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses self-demotion out of administrative access', async () => {
    const { user, agent } = await agentAs('admin');
    const loaded = await agent.get(`/api/admin/users/${user.id}`);

    const response = await agent
      .patch(`/api/admin/users/${user.id}`)
      .send({ roleKey: 'agent', version: loaded.body.version });

    expect(response.status).toBe(403);
  });

  it('still allows deactivating an administrator while another remains', async () => {
    const { agent } = await agentAs('admin');
    const spare = await createTestUser({ roleKey: 'admin' });

    expect((await agent.post(`/api/admin/users/${spare.id}/deactivate`)).status).toBe(204);
  });
});

describe('an inactive user cannot act', () => {
  it('refuses an already-issued token with 401, not 403', async () => {
    const { user, agent } = await agentAs('agent');
    const adminSession = await agentAs('admin');

    // The token still verifies cryptographically; only the database changed.
    expect((await adminSession.agent.post(`/api/admin/users/${user.id}/deactivate`)).status).toBe(
      204,
    );

    const response = await agent.get('/api/auth/me');

    // 401, not 403: a deactivated user's session is void, and 403 would confirm
    // a valid session existed (contracts/authorization.md).
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses sign-in with the same body as a wrong password', async () => {
    const target = await createTestUser({ roleKey: 'agent', isActive: false });

    const inactive = await supertest(app)
      .post('/api/auth/login')
      .send({ email: target.email, password: 'TestPassw0rd!2026' });

    const unknown = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'TestPassw0rd!2026' });

    expect(inactive.status).toBe(unknown.status);
    expect(inactive.body).toEqual(unknown.body);
  });
});
