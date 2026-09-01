import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { AuditLog, Customer, PortalAccount } from '../../src/models/index.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { buildPortalWorld, PORTAL_PASSWORD, type PortalWorld } from './fixtures.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimit();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * PORTAL SIGN-IN AND WHAT ENDS IT (Phase 8, FR-005, FR-006, FR-009, FR-060,
 * SC-004, SC-006, SC-031).
 *
 * The enumeration defences here are copied from Phase 1 rather than referenced,
 * and they matter MORE here. Staff sign-in is reachable by anyone who finds the
 * admin URL; the portal's is reachable by anyone at all, and its email addresses
 * are the organisation's entire customer list. An endpoint that says "no such
 * account" is an endpoint that confirms one for every address it does not say it
 * about.
 */

describe('six ways to fail sign-in, one answer (FR-006, SC-006)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  async function attempt(email: string, password: string) {
    resetRateLimit();
    return supertest(app).post('/api/portal/auth/login').send({ email, password });
  }

  it('is identical for every kind of failure', async () => {
    const baseline = await attempt('nobody-at-all@example.invalid', PORTAL_PASSWORD);

    expect(baseline.status).toBe(401);
    expect(baseline.body.error?.code).toBe('INVALID_CREDENTIALS');

    // 1. Wrong password on a real account.
    const wrongPassword = await attempt(world.a.email, 'Definitely-Wr0ng!2026');

    // 2. Withdrawn account.
    await PortalAccount.update({ status: 'withdrawn' }, { where: { id: world.b.accountId } });
    const withdrawn = await attempt(world.b.email, PORTAL_PASSWORD);

    // 3. Deactivated customer.
    await Customer.update({ is_active: false }, { where: { id: world.customerId } });
    const inactive = await attempt(world.a.email, PORTAL_PASSWORD);
    await Customer.update({ is_active: true }, { where: { id: world.customerId } });

    // 4. Locked out.
    await PortalAccount.update(
      { locked_until: new Date(Date.now() + 600_000) },
      { where: { id: world.a.accountId } },
    );
    const locked = await attempt(world.a.email, PORTAL_PASSWORD);

    for (const response of [wrongPassword, withdrawn, inactive, locked]) {
      expect(response.status).toBe(baseline.status);
      expect(response.body).toEqual(baseline.body);
    }
  });

  it('records every failure, so probing is visible (FR-008)', async () => {
    await attempt('nobody-at-all@example.invalid', 'anything');

    const entry = await AuditLog.findOne({ where: { action: 'portal.login.failure' } });

    expect(entry).not.toBeNull();
    // NULL, always. A customer is not a `users` row, and putting a portal
    // account id here would be a dangling reference into the staff table.
    expect(entry?.actor_user_id).toBeNull();
    expect(entry?.actor_email).toBe('nobody-at-all@example.invalid');
  });
});

describe('lockout (FR-005)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  it('locks after the configured number of failures, and is recorded', async () => {
    for (let attempt = 0; attempt < env.AUTH_MAX_FAILED_ATTEMPTS; attempt += 1) {
      resetRateLimit();
      await supertest(app)
        .post('/api/portal/auth/login')
        .send({ email: world.a.email, password: 'Wr0ng-Passw0rd!2026' });
    }

    const account = await PortalAccount.findByPk(world.a.accountId);
    expect(account?.locked_until).not.toBeNull();

    // Now the CORRECT password is refused, identically.
    resetRateLimit();
    const correct = await supertest(app)
      .post('/api/portal/auth/login')
      .send({ email: world.a.email, password: PORTAL_PASSWORD });

    expect(correct.status).toBe(401);

    const locked = await AuditLog.findOne({ where: { action: 'portal.account.locked' } });
    expect(locked).not.toBeNull();
  });

  it('is tracked separately from staff lockouts', async () => {
    const { user } = await agentAs('agent');

    for (let attempt = 0; attempt < env.AUTH_MAX_FAILED_ATTEMPTS; attempt += 1) {
      resetRateLimit();
      await supertest(app)
        .post('/api/portal/auth/login')
        .send({ email: world.a.email, password: 'Wr0ng-Passw0rd!2026' });
    }

    // A customer being probed must not lock out a member of staff, which is what
    // sharing the columns would have allowed.
    const { User } = await import('../../src/models/index.js');
    const staff = await User.findByPk(user.id);
    expect(staff?.failed_login_attempts).toBe(0);
    expect(staff?.locked_until).toBeNull();
  });
});

describe('a session ends when access is taken away (FR-009, FR-060, SC-004, SC-031)', () => {
  let world: PortalWorld;
  let admin: AuthedAgent;

  beforeEach(async () => {
    world = await buildPortalWorld();
    ({ agent: admin } = await agentAs('admin'));
  });

  it('a live access token stops working the moment access is withdrawn', async () => {
    const before = await supertest(app)
      .get('/api/portal/tickets')
      .set('Authorization', `Bearer ${world.a.accessToken}`);
    expect(before.status).toBe(200);

    await admin.post(`/api/admin/portal/accounts/${world.a.accountId}/withdraw`).send({});

    // No waiting for the token to expire: the middleware reads the account fresh
    // on every request, which is the whole reason it does (research D10).
    const after = await supertest(app)
      .get('/api/portal/tickets')
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(after.status).toBe(401);
    expect(after.body.error?.code).toBe('UNAUTHENTICATED');
  });

  it('a week-old refresh token stops working too', async () => {
    // Sign in properly so the refresh cookie is real.
    const login = await supertest(app)
      .post('/api/portal/auth/login')
      .send({ email: world.a.email, password: PORTAL_PASSWORD });

    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeTruthy();

    await admin.post(`/api/admin/portal/accounts/${world.a.accountId}/withdraw`).send({});

    // THE EPOCH CHECK. Without it, a customer whose access was withdrawn could
    // mint a fresh access token from a cookie for another seven days.
    const refresh = await supertest(app).post('/api/portal/auth/refresh').set('Cookie', cookie);

    expect(refresh.status).toBe(401);
  });

  it('withdrawing one contact leaves their colleague unaffected (FR-060a)', async () => {
    await admin.post(`/api/admin/portal/accounts/${world.a.accountId}/withdraw`).send({});

    const colleague = await supertest(app)
      .get('/api/portal/tickets')
      .set('Authorization', `Bearer ${world.b.accessToken}`);

    expect(colleague.status).toBe(200);
  });

  it('a deactivated customer’s session dies with the record (FR-009)', async () => {
    await Customer.update({ is_active: false }, { where: { id: world.customerId } });

    const response = await supertest(app)
      .get('/api/portal/tickets')
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(response.status).toBe(401);
  });

  it('removing the contact ends the account (FR-003b)', async () => {
    const { CustomerContact } = await import('../../src/models/index.js');
    await CustomerContact.destroy({ where: { id: world.a.contactId } });

    const response = await supertest(app)
      .get('/api/portal/tickets')
      .set('Authorization', `Bearer ${world.a.accessToken}`);

    expect(response.status).toBe(401);
    // CASCADE: the credential goes with the contact rather than resolving to
    // nothing.
    expect(await PortalAccount.findByPk(world.a.accountId)).toBeNull();
  });

  it('a customer can end every session themselves (FR-007)', async () => {
    const login = await supertest(app)
      .post('/api/portal/auth/login')
      .send({ email: world.a.email, password: PORTAL_PASSWORD });

    const token = login.body.accessToken as string;
    const cookie = login.headers['set-cookie'];

    await supertest(app)
      .post('/api/portal/auth/logout-all')
      .set('Authorization', `Bearer ${token}`);

    const refresh = await supertest(app).post('/api/portal/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });
});

describe('credential recovery reveals nothing (FR-006)', () => {
  it('always returns 204, for a known and an unknown address alike', async () => {
    const world = await buildPortalWorld();

    resetRateLimit();
    const known = await supertest(app)
      .post('/api/portal/auth/forgot-password')
      .send({ email: world.a.email });

    resetRateLimit();
    const unknown = await supertest(app)
      .post('/api/portal/auth/forgot-password')
      .send({ email: 'nobody-at-all@example.invalid' });

    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
    expect(known.body).toEqual(unknown.body);
  });
});
