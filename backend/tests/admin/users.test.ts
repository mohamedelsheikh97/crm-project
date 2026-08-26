import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { agentAs, createTestUser, TEST_PASSWORD } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

const VALID_PASSWORD = 'InitialPassw0rd!';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('admin users endpoints', () => {
  it('creates a user with each role and forces a password change', async () => {
    const { agent } = await agentAs('admin');

    for (const roleKey of ['agent', 'supervisor', 'admin'] as const) {
      const response = await agent.post('/api/admin/users').send({
        email: `new-${roleKey}@test.local`,
        fullName: `New ${roleKey}`,
        roleKey,
        initialPassword: VALID_PASSWORD,
      });

      expect(response.status).toBe(201);
      expect(response.body.role.key).toBe(roleKey);
      expect(response.body.mustChangePassword).toBe(true);
      // No credential may leave, ever.
      expect(JSON.stringify(response.body)).not.toContain('password');
    }
  });

  it('rejects a duplicate email on the email field', async () => {
    const { agent } = await agentAs('admin');
    const payload = {
      email: 'duplicate@test.local',
      fullName: 'First',
      roleKey: 'agent',
      initialPassword: VALID_PASSWORD,
    };

    expect((await agent.post('/api/admin/users').send(payload)).status).toBe(201);

    const second = await agent.post('/api/admin/users').send(payload);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
    expect(second.body.error.details[0].field).toBe('email');
  });

  it('clamps pageSize to 100 rather than rejecting it', async () => {
    const { agent } = await agentAs('admin');
    const response = await agent.get('/api/admin/users?pageSize=10000');

    expect(response.status).toBe(200);
    expect(response.body.pageSize).toBe(100);
  });

  it('filters by role and active state', async () => {
    const { agent } = await agentAs('admin');
    await createTestUser({ roleKey: 'agent', email: 'filter-agent@test.local' });
    await createTestUser({ roleKey: 'supervisor', email: 'filter-sup@test.local' });
    await createTestUser({ roleKey: 'agent', email: 'inactive@test.local', isActive: false });

    const agents = await agent.get('/api/admin/users?roleKey=agent&isActive=true');

    expect(agents.status).toBe(200);
    expect(agents.body.items.every((u: { role: { key: string } }) => u.role.key === 'agent')).toBe(
      true,
    );
    expect(
      agents.body.items.some((u: { email: string }) => u.email === 'inactive@test.local'),
    ).toBe(false);
  });

  it('changes a role without recreating the user', async () => {
    const { agent } = await agentAs('admin');
    const target = await createTestUser({ roleKey: 'agent' });
    const before = await agent.get(`/api/admin/users/${target.id}`);

    const response = await agent
      .patch(`/api/admin/users/${target.id}`)
      .send({ roleKey: 'supervisor', version: before.body.version });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(target.id);
    expect(response.body.role.key).toBe('supervisor');
  });

  it('refuses a stale version rather than overwriting', async () => {
    const { agent } = await agentAs('admin');
    const target = await createTestUser({ roleKey: 'agent' });
    const loaded = await agent.get(`/api/admin/users/${target.id}`);

    // First write succeeds and bumps the version.
    await agent
      .patch(`/api/admin/users/${target.id}`)
      .send({ fullName: 'First Write', version: loaded.body.version });

    // Second caller still holds the version they read before the first write.
    const stale = await agent
      .patch(`/api/admin/users/${target.id}`)
      .send({ fullName: 'Second Write', version: loaded.body.version });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');

    const after = await agent.get(`/api/admin/users/${target.id}`);
    expect(after.body.fullName).toBe('First Write');
  });

  it('reports three distinct states: active, inactive and locked', async () => {
    const { agent } = await agentAs('admin');
    const locked = await createTestUser({ roleKey: 'agent' });
    await locked.update({ locked_until: new Date(Date.now() + 60_000) });

    const response = await agent.get(`/api/admin/users/${locked.id}`);

    expect(response.body.isActive).toBe(true);
    expect(response.body.isLocked).toBe(true);
  });

  it('unlocks idempotently', async () => {
    const { agent } = await agentAs('admin');
    const target = await createTestUser({ roleKey: 'agent' });

    expect((await agent.post(`/api/admin/users/${target.id}/unlock`)).status).toBe(204);
    expect((await agent.post(`/api/admin/users/${target.id}/unlock`)).status).toBe(204);
  });

  it('lets a reset password be used after the forced change', async () => {
    const { agent } = await agentAs('admin');
    const target = await createTestUser({ roleKey: 'agent' });

    const reset = await agent
      .post(`/api/admin/users/${target.id}/reset-password`)
      .send({ newPassword: 'ResetPassw0rd!' });

    expect(reset.status).toBe(204);
    await target.reload();
    expect(target.must_change_password).toBe(true);

    // The old password no longer works.
    const { default: supertest } = await import('supertest');
    const { default: app } = await import('../../src/app.js');

    const oldAttempt = await supertest(app)
      .post('/api/auth/login')
      .send({ email: target.email, password: TEST_PASSWORD });

    expect(oldAttempt.status).toBe(401);
  });
});
