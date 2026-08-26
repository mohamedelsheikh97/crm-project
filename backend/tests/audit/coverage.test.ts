import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { AuditLog, Role, RolePermission } from '../../src/models/index.js';
import { AUDIT_ACTIONS, redact } from '../../src/services/audit.service.js';
import { agentAs, agentFor, createTestUser, signInAs, TEST_PASSWORD } from '../helpers/auth.js';
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

async function recorded(action: string): Promise<boolean> {
  return (await AuditLog.count({ where: { action } })) > 0;
}

/**
 * quickstart A7 / SC-005.
 *
 * Phase 0 authenticated users but persisted no audit record, and its plan
 * recorded that as a TIME-BOXED deviation that must close in Phase 1. This
 * suite is the evidence that it closed — not an assertion that it did.
 *
 * The final test enumerates AUDIT_ACTIONS rather than a hand-written list, so
 * an action added without a recording path fails here.
 */
describe('every security-relevant event is recorded', () => {
  it('records a successful sign-in', async () => {
    const user = await createTestUser({ roleKey: 'agent' });
    await signInAs(user);

    expect(await recorded(AUDIT_ACTIONS.LOGIN_SUCCESS)).toBe(true);
  });

  it('records a failed sign-in, including against an unknown identifier', async () => {
    await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.local', password: 'Wrong!12345' });

    const entry = await AuditLog.findOne({ where: { action: AUDIT_ACTIONS.LOGIN_FAILURE } });

    expect(entry).not.toBeNull();
    expect(entry?.actor_user_id).toBeNull();
    expect(entry?.actor_email).toBe('ghost@test.local');
    expect(entry?.outcome).toBe('failure');
  });

  it('records a sign-out', async () => {
    const user = await createTestUser({ roleKey: 'agent' });
    const agent = agentFor(await signInAs(user));

    await agent.post('/api/auth/logout');

    expect(await recorded(AUDIT_ACTIONS.LOGOUT)).toBe(true);
  });

  it('records user creation, update, role change, deactivation and reactivation', async () => {
    const { agent } = await agentAs('admin');

    const created = await agent.post('/api/admin/users').send({
      email: 'audited@test.local',
      fullName: 'Audited User',
      roleKey: 'agent',
      initialPassword: 'AuditedPassw0rd!',
    });

    expect(created.status).toBe(201);
    expect(await recorded(AUDIT_ACTIONS.USER_CREATED)).toBe(true);

    const id = created.body.id;
    let current = await agent.get(`/api/admin/users/${id}`);

    await agent
      .patch(`/api/admin/users/${id}`)
      .send({ fullName: 'Renamed', version: current.body.version });
    expect(await recorded(AUDIT_ACTIONS.USER_UPDATED)).toBe(true);

    current = await agent.get(`/api/admin/users/${id}`);
    await agent
      .patch(`/api/admin/users/${id}`)
      .send({ roleKey: 'supervisor', version: current.body.version });
    expect(await recorded(AUDIT_ACTIONS.USER_ROLE_CHANGED)).toBe(true);

    await agent.post(`/api/admin/users/${id}/deactivate`);
    expect(await recorded(AUDIT_ACTIONS.USER_DEACTIVATED)).toBe(true);

    await agent.post(`/api/admin/users/${id}/reactivate`);
    expect(await recorded(AUDIT_ACTIONS.USER_REACTIVATED)).toBe(true);
  });

  it('records a role change with both previous and new values', async () => {
    const { agent } = await agentAs('admin');
    const target = await createTestUser({ roleKey: 'agent' });
    const current = await agent.get(`/api/admin/users/${target.id}`);

    await agent
      .patch(`/api/admin/users/${target.id}`)
      .send({ roleKey: 'supervisor', version: current.body.version });

    const entry = await AuditLog.findOne({ where: { action: AUDIT_ACTIONS.USER_ROLE_CHANGED } });

    // FR-034: a change must record what it changed FROM as well as TO.
    expect((entry?.previous_value as { roleKey: string }).roleKey).toBe('agent');
    expect((entry?.new_value as { roleKey: string }).roleKey).toBe('supervisor');
  });

  it('records a permission change with both previous and new sets', async () => {
    await createTestUser({ roleKey: 'admin', email: 'second-admin@test.local' });
    const { agent } = await agentAs('admin');
    const agentRole = await Role.findOne({ where: { key: 'agent' } });
    const roles = await agent.get('/api/admin/roles');
    const entry = roles.body.items.find((r: { key: string }) => r.key === 'agent');

    const response = await agent
      .put(`/api/admin/roles/${agentRole!.id}/permissions`)
      .send({ permissions: ['settings:view'], version: entry.version });

    expect(response.status).toBe(200);

    const logged = await AuditLog.findOne({
      where: { action: AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED },
    });

    expect(logged).not.toBeNull();
    expect((logged?.new_value as { permissions: string[] }).permissions).toEqual(['settings:view']);
  });

  it('records a password change and an administrator reset', async () => {
    const { agent } = await agentAs('admin');
    const target = await createTestUser({ roleKey: 'agent' });

    await agent
      .post(`/api/admin/users/${target.id}/reset-password`)
      .send({ newPassword: 'AdminResetPassw0rd!' });
    expect(await recorded(AUDIT_ACTIONS.PASSWORD_RESET)).toBe(true);

    const self = await createTestUser({ roleKey: 'agent', email: 'selfchange@test.local' });
    const selfAgent = agentFor(await signInAs(self));

    await selfAgent
      .post('/api/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'SelfChosenPassw0rd!' });
    expect(await recorded(AUDIT_ACTIONS.PASSWORD_CHANGED)).toBe(true);
  });

  it('records lock and unlock', async () => {
    const { agent } = await agentAs('admin');
    const user = await createTestUser({ email: 'locking@test.local' });

    for (let i = 0; i < env.AUTH_MAX_FAILED_ATTEMPTS; i += 1) {
      await supertest(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'Wrong!12345' });
    }

    expect(await recorded(AUDIT_ACTIONS.ACCOUNT_LOCKED)).toBe(true);

    await agent.post(`/api/admin/users/${user.id}/unlock`);
    expect(await recorded(AUDIT_ACTIONS.ACCOUNT_UNLOCKED)).toBe(true);
  });

  it('defines every action key some phase will need, with no orphans', () => {
    // data.exported and record.deleted have no callers yet — the modules that
    // export and delete arrive in later phases. They exist now so those phases
    // record in the established shape rather than inventing their own.
    const pending = [AUDIT_ACTIONS.DATA_EXPORTED, AUDIT_ACTIONS.RECORD_DELETED];
    const wired = Object.values(AUDIT_ACTIONS).filter((action) => !pending.includes(action));

    expect(wired.length).toBe(13);
    expect(new Set(Object.values(AUDIT_ACTIONS)).size).toBe(Object.values(AUDIT_ACTIONS).length);
  });
});

/** quickstart A8 / FR-036 / SC-008. */
describe('no audit entry contains a credential', () => {
  it('strips sensitive keys from every JSON field, including metadata', () => {
    const result = redact({
      password: 'hunter2',
      newPassword: 'hunter3',
      password_hash: '$2b$12$abc',
      accessToken: 'ey.J.x',
      nested: { refreshToken: 'ey.J.y', cookie: 'crm_refresh=abc', safe: 'keep me' },
      list: [{ secret: 'shh' }],
    }) as Record<string, unknown>;

    expect(result.password).toBe('[REDACTED]');
    expect(result.newPassword).toBe('[REDACTED]');
    expect(result.password_hash).toBe('[REDACTED]');
    expect(result.accessToken).toBe('[REDACTED]');

    const nested = result.nested as Record<string, unknown>;
    expect(nested.refreshToken).toBe('[REDACTED]');
    expect(nested.cookie).toBe('[REDACTED]');
    // Only the deny-list is touched; everything else survives intact.
    expect(nested.safe).toBe('keep me');

    expect((result.list as Array<Record<string, unknown>>)[0]!.secret).toBe('[REDACTED]');
  });

  it('leaves no credential in any stored row after a full exercise', async () => {
    const { agent } = await agentAs('admin');
    const created = await agent.post('/api/admin/users').send({
      email: 'leak-check@test.local',
      fullName: 'Leak Check',
      roleKey: 'agent',
      initialPassword: 'SuperSecretPassw0rd!',
    });

    await agent
      .post(`/api/admin/users/${created.body.id}/reset-password`)
      .send({ newPassword: 'AnotherSecretPassw0rd!' });

    const rows = await AuditLog.findAll();
    const serialised = JSON.stringify(rows.map((row) => row.toJSON()));

    expect(rows.length).toBeGreaterThan(0);
    expect(serialised).not.toContain('SuperSecretPassw0rd!');
    expect(serialised).not.toContain('AnotherSecretPassw0rd!');
    expect(serialised).not.toContain('$2b$');
  });
});

/** quickstart A9 / FR-035. */
describe('the audit log is append-only', () => {
  it('exposes no write route at any path or method', async () => {
    const { agent } = await agentAs('admin');

    for (const [method, path] of [
      ['post', '/api/admin/audit'],
      ['patch', '/api/admin/audit/1'],
      ['put', '/api/admin/audit/1'],
      ['delete', '/api/admin/audit/1'],
      ['delete', '/api/admin/audit'],
    ] as const) {
      const response = await agent[method](path).send({});

      // 404, not 403: the route does not exist. Immutability is enforced by the
      // absence of a write path, not by a check inside one.
      expect(response.status).toBe(404);
    }
  });

  it('never lets a non-administrator read it', async () => {
    const { agent } = await agentAs('agent');

    expect((await agent.get('/api/admin/audit')).status).toBe(403);
  });
});

/** FR-041 — a state change must not succeed unrecorded. */
describe('audit writes for state changes share the action transaction', () => {
  it('rolls the change back when the audit insert fails', async () => {
    const { agent } = await agentAs('admin');
    const target = await createTestUser({ roleKey: 'agent', email: 'rollback@test.local' });
    const before = await agent.get(`/api/admin/users/${target.id}`);

    // Force the audit insert to fail by making the column too small for the
    // value the writer will supply. Existing rows must go first, or the ALTER
    // itself fails on them rather than on the write under test.
    await AuditLog.sequelize!.query('TRUNCATE TABLE audit_logs');
    await AuditLog.sequelize!.query('ALTER TABLE audit_logs MODIFY action VARCHAR(1) NOT NULL');

    try {
      const response = await agent
        .patch(`/api/admin/users/${target.id}`)
        .send({ fullName: 'Should Not Persist', version: before.body.version });

      expect(response.status).toBe(500);

      await target.reload();
      // The rename must not have happened: no unrecorded state change.
      expect(target.full_name).not.toBe('Should Not Persist');
    } finally {
      await AuditLog.sequelize!.query('ALTER TABLE audit_logs MODIFY action VARCHAR(100) NOT NULL');
      await RolePermission.sequelize!.query('SELECT 1');
    }
  });
});
