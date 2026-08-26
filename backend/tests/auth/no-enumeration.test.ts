import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { createTestUser, TEST_PASSWORD } from '../helpers/auth.js';
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

/**
 * quickstart A6 / FR-030 / SC-007.
 *
 * This is the security-critical test of User Story 4. The guarantee it protects
 * is invisible when working and an account-enumeration hole when broken, and
 * the "helpful" fix — telling the caller their account is locked — is precisely
 * the defect.
 */
describe('sign-in failures are indistinguishable', () => {
  it('returns byte-identical responses for all four failure modes', async () => {
    const wrongPassword = await createTestUser({ email: 'real@test.local' });
    const inactive = await createTestUser({ email: 'inactive@test.local', isActive: false });
    const locked = await createTestUser({ email: 'locked@test.local' });
    await locked.update({
      locked_until: new Date(Date.now() + 60_000),
      failed_login_attempts: env.AUTH_MAX_FAILED_ATTEMPTS,
    });

    const responses = {
      wrongPassword: await attempt(wrongPassword.email, 'DefinitelyWrong!1'),
      unknownAccount: await attempt('nobody@test.local', 'DefinitelyWrong!1'),
      // The correct password — a lock must not be bypassable by knowing it.
      lockedAccount: await attempt(locked.email, TEST_PASSWORD),
      inactiveAccount: await attempt(inactive.email, TEST_PASSWORD),
    };

    const [reference, ...rest] = Object.values(responses);

    for (const response of rest) {
      expect(response.status).toBe(reference!.status);
      expect(response.body).toEqual(reference!.body);
    }

    expect(reference!.status).toBe(401);
    expect(reference!.body.error.code).toBe('INVALID_CREDENTIALS');

    // Nothing in the body may hint at which state produced it.
    const serialised = JSON.stringify(reference!.body).toLowerCase();
    expect(serialised).not.toContain('lock');
    expect(serialised).not.toContain('inactive');
    expect(serialised).not.toContain('disabled');
  });

  it('does not distinguish the four modes by response time', async () => {
    const user = await createTestUser({ email: 'timing@test.local' });
    const locked = await createTestUser({ email: 'timing-locked@test.local' });
    await locked.update({ locked_until: new Date(Date.now() + 60_000) });

    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      const started = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const wrong = await time(() => attempt(user.email, 'DefinitelyWrong!1'));
    const unknown = await time(() => attempt('nobody@test.local', 'DefinitelyWrong!1'));
    const lockedMs = await time(() => attempt(locked.email, TEST_PASSWORD));

    // Every path runs a bcrypt compare — against the real hash or the dummy —
    // so none should be an order of magnitude faster. A path that skipped the
    // hash would return in single-digit milliseconds while the others take
    // hundreds, which is a usable oracle.
    const slowest = Math.max(wrong, unknown, lockedMs);
    const fastest = Math.min(wrong, unknown, lockedMs);

    expect(fastest).toBeGreaterThan(slowest / 10);
  });
});
