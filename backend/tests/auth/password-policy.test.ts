import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../src/config/env.js';
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

/** quickstart A4 — FR-022 to FR-024. */
describe('password policy', () => {
  it('names the specific failing rule rather than rejecting generically', async () => {
    const user = await createTestUser({ roleKey: 'agent' });
    const agent = agentFor(await signInAs(user));

    const tooShort = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Ab1' });

    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error.code).toBe('VALIDATION_ERROR');
    expect(tooShort.body.error.details.map((d: { message: string }) => d.message)).toContain(
      'password.rule.minLength',
    );

    const noDigit = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'NoDigitsHereAtAll' });

    expect(noDigit.status).toBe(400);
    expect(noDigit.body.error.details.map((d: { message: string }) => d.message)).toContain(
      'password.rule.digit',
    );
  });

  it('enforces the configured minimum length', async () => {
    const user = await createTestUser({ roleKey: 'agent' });
    const agent = agentFor(await signInAs(user));

    // One character short of the configured minimum, otherwise compliant.
    const candidate = 'Aa1'.padEnd(env.PASSWORD_MIN_LENGTH - 1, 'x');

    const response = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: candidate });

    expect(response.status).toBe(400);
  });

  it('rejects a wrong current password with 401, not 400', async () => {
    const user = await createTestUser({ roleKey: 'agent' });
    const agent = agentFor(await signInAs(user));

    const response = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'NotMyPassword!1', newPassword: 'BrandNewPassw0rd!' });

    // A failed credential check, not a malformed request.
    expect(response.status).toBe(401);
  });

  it('refuses to reuse a recent password', async () => {
    const user = await createTestUser({ roleKey: 'agent' });
    const agent = agentFor(await signInAs(user));

    const first = 'FirstNewPassw0rd!';
    expect(
      (
        await agent
          .post('/api/auth/change-password')
          .send({ currentPassword: TEST_PASSWORD, newPassword: first })
      ).status,
    ).toBe(204);

    const second = 'SecondNewPassw0rd!';
    expect(
      (
        await agent
          .post('/api/auth/change-password')
          .send({ currentPassword: first, newPassword: second })
      ).status,
    ).toBe(204);

    // Back to the first, which is still inside the history window.
    const reuse = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: second, newPassword: first });

    expect(reuse.status).toBe(400);
    expect(reuse.body.error.details.map((d: { message: string }) => d.message)).toContain(
      'password.rule.reused',
    );
  });

  it('clears the forced-change flag once the password is set', async () => {
    const user = await createTestUser({ roleKey: 'agent', mustChangePassword: true });
    const agent = agentFor(await signInAs(user));

    expect((await agent.get('/api/auth/me')).body.mustChangePassword).toBe(true);

    await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'FreshPassw0rd!2026' });

    expect((await agent.get('/api/auth/me')).body.mustChangePassword).toBe(false);
  });

  it('applies policy to an administrator-set initial password', async () => {
    const { agent } = await agentAs('admin');

    const response = await agent.post('/api/admin/users').send({
      email: 'weak@test.local',
      fullName: 'Weak Password',
      roleKey: 'agent',
      initialPassword: 'weak',
    });

    expect(response.status).toBe(400);
    expect(
      response.body.error.details.some((d: { field: string }) => d.field === 'initialPassword'),
    ).toBe(true);
  });
});
