import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { AuditLog } from '../../src/models/index.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { agentAs, createTestUser, TEST_PASSWORD } from '../helpers/auth.js';
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

function attempt(email: string, password: string) {
  return supertest(app).post('/api/auth/login').send({ email, password });
}

async function failUntilLocked(email: string): Promise<void> {
  for (let i = 0; i < env.AUTH_MAX_FAILED_ATTEMPTS; i += 1) {
    await attempt(email, 'DefinitelyWrong!1');
  }
}

/** quickstart A5 — FR-026 to FR-029. */
describe('account lockout', () => {
  it('locks after the configured number of consecutive failures', async () => {
    const user = await createTestUser({ email: 'lockme@test.local' });

    await failUntilLocked(user.email);
    await user.reload();

    expect(user.failed_login_attempts).toBeGreaterThanOrEqual(env.AUTH_MAX_FAILED_ATTEMPTS);
    expect(user.isLocked).toBe(true);
  });

  it('refuses the correct password while locked', async () => {
    const user = await createTestUser({ email: 'correct-but-locked@test.local' });

    await failUntilLocked(user.email);

    const response = await attempt(user.email, TEST_PASSWORD);

    // Knowing the password must not bypass a lock (FR-027).
    expect(response.status).toBe(401);
    expect(response.body.accessToken).toBeUndefined();
  });

  it('accepts the correct password again once the lockout period elapses', async () => {
    const user = await createTestUser({ email: 'expires@test.local' });

    await failUntilLocked(user.email);
    // Reload first: the failed attempts bumped the row's version, and writing
    // through the stale instance is refused by optimistic locking — correctly.
    await user.reload();
    // Wind the clock back rather than waiting out the configured minutes.
    await user.update({ locked_until: new Date(Date.now() - 1000) });

    const response = await attempt(user.email, TEST_PASSWORD);

    // Self-clearing, with no administrator involvement (FR-028).
    expect(response.status).toBe(200);
  });

  it('resets the failure count on a successful sign-in', async () => {
    const user = await createTestUser({ email: 'resets@test.local' });

    await attempt(user.email, 'DefinitelyWrong!1');
    await attempt(user.email, 'DefinitelyWrong!1');
    await user.reload();
    expect(user.failed_login_attempts).toBe(2);

    await attempt(user.email, TEST_PASSWORD);
    await user.reload();

    expect(user.failed_login_attempts).toBe(0);
    expect(user.locked_until).toBeNull();
  });

  it('lets an administrator unlock immediately', async () => {
    const { agent } = await agentAs('admin');
    const user = await createTestUser({ email: 'unlockme@test.local' });

    await failUntilLocked(user.email);
    expect((await attempt(user.email, TEST_PASSWORD)).status).toBe(401);

    expect((await agent.post(`/api/admin/users/${user.id}/unlock`)).status).toBe(204);
    expect((await attempt(user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it('records the lockout in the audit log', async () => {
    const user = await createTestUser({ email: 'audited-lock@test.local' });

    await failUntilLocked(user.email);

    const entry = await AuditLog.findOne({
      where: { action: AUDIT_ACTIONS.ACCOUNT_LOCKED, actor_user_id: user.id },
    });

    expect(entry).not.toBeNull();
    expect(entry?.outcome).toBe('failure');
  });

  it('records every failed attempt, including against an unknown identifier', async () => {
    // Probing must be visible even when no account matches (FR-037).
    await attempt('ghost@test.local', 'DefinitelyWrong!1');

    const entry = await AuditLog.findOne({
      where: { action: AUDIT_ACTIONS.LOGIN_FAILURE, actor_email: 'ghost@test.local' },
    });

    expect(entry).not.toBeNull();
    expect(entry?.actor_user_id).toBeNull();
  });
});
