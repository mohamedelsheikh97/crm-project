import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../src/app.js';
import { adapterFor } from '../../src/channels/registry.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import {
  AuditLog,
  Customer,
  CustomerContact,
  PortalAccount,
  PortalInvitation,
} from '../../src/models/index.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimit();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * INVITE-ONLY (Phase 8, Clarifications Q1, FR-002, SC-025 - SC-027).
 *
 * The portal's front door, and the three properties that make it safe:
 *
 *   1. THERE IS NO OTHER DOOR. No registration route exists, and the test below
 *      goes looking for one rather than taking the router's word for it.
 *   2. FOUR WAYS TO FAIL, ONE ANSWER. Expired, spent, revoked, and never existed
 *      are indistinguishable. The moment they are not, a holder of guessed tokens
 *      learns which ones were real.
 *   3. IT GOES WHERE THE CONTACT SAYS. The address is not a parameter, at issue
 *      time or at acceptance. An invitation redirectable by its issuer would turn
 *      `portal:manage` into "may grant a stranger access to any customer's
 *      correspondence".
 */

/** Captures what the email adapter was asked to send, without sending it. */
function captureMail() {
  const sent: Array<{ to: string; body: string; subject: string | null }> = [];
  const adapter = adapterFor('email');

  vi.spyOn(adapter, 'send').mockImplementation(async (message) => {
    sent.push({ to: message.recipientIdentity, body: message.body, subject: message.subject });
    return {
      providerMessageId: 'test',
      outboundMessageId: null,
      state: 'sent',
      detail: null,
      retryable: false,
    };
  });

  return sent;
}

/** The token out of the emailed link — the only place it ever exists. */
function tokenFrom(body: string): string {
  const match = /\/portal\/invite\/([^\s]+)/.exec(body);
  if (!match) throw new Error(`No invitation link in body:\n${body}`);
  return match[1] as string;
}

async function makeCustomerWithEmail(options: { provisional?: boolean } = {}) {
  const customer = await Customer.create({
    display_name: 'Acme Industrial',
    company: 'Acme Industrial LLC',
    address: null,
    is_active: true,
    is_provisional: options.provisional ?? false,
    created_by_user_id: null,
  });

  const contact = await CustomerContact.create({
    customer_id: customer.id,
    kind: 'email',
    value_raw: 'Hala@Example.COM',
    value_normalised: 'hala@example.com',
    is_primary: true,
  });

  return { customer, contact };
}

describe('there is no way in except an invitation', () => {
  it('exposes no registration route (FR-002a, SC-025)', async () => {
    // Every shape somebody would try.
    //
    // THE ASSERTION IS "NEVER SUCCEEDS, AND CREATES NOTHING", not "returns 404".
    // The first version of this test demanded 404 and failed — correctly, and on
    // the code rather than the requirement: an unmatched path UNDER the portal
    // router meets `authenticatePortal` before route matching gives up, so it
    // answers 401. That is not a weaker refusal, it is a different one, and
    // pinning the status would have made this test a description of Express's
    // middleware ordering rather than of FR-002a.
    // COUNTED BEFORE AND AFTER, rather than asserting the world holds none.
    // The claim is about these endpoints — "none of them is a way in" — and a
    // delta says exactly that, where an absolute count also asserts that no
    // fixture anywhere left a row behind.
    const accountsBefore = await PortalAccount.count();

    const candidates = [
      '/api/portal/register',
      '/api/portal/signup',
      '/api/portal/accounts',
      '/api/portal/auth/register',
      '/api/portal/invitations',
      '/api/public/portal/register',
      '/api/customers/1/portal-accounts',
    ];

    for (const path of candidates) {
      const response = await supertest(app).post(path).send({
        email: 'stranger@example.com',
        password: 'Str0ng-Passw0rd!2026',
      });

      // Refused, one way or another. What matters is that nothing here is a way
      // in: no 2xx, and no account afterwards.
      expect([401, 404]).toContain(response.status);
    }

    // THE REAL ASSERTION. Whatever those endpoints answered, the only path in
    // this application that creates a portal account is invitation acceptance,
    // and none of the above is it.
    expect(await PortalAccount.count()).toBe(accountsBefore);
  });
});

describe('issuing an invitation', () => {
  let agent: AuthedAgent;

  beforeEach(async () => {
    ({ agent } = await agentAs('admin'));
  });

  it('delivers only to the address on the named contact (FR-002d, SC-027)', async () => {
    const sent = captureMail();
    const { customer, contact } = await makeCustomerWithEmail();

    const response = await agent
      .post(`/api/customers/${customer.id}/contacts/${contact.id}/portal-invitations`)
      // An address supplied by the CALLER, which must be ignored entirely.
      .send({ email: 'attacker@evil.example' });

    expect(response.status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('Hala@Example.COM');
    expect(sent[0]?.body).not.toContain('attacker@evil.example');
  });

  it('sends a bilingual invitation that names the organisation and the address', async () => {
    const sent = captureMail();
    const { customer, contact } = await makeCustomerWithEmail();

    await agent
      .post(`/api/customers/${customer.id}/contacts/${contact.id}/portal-invitations`)
      .send({});

    const body = sent[0]?.body ?? '';

    // Prose in BOTH languages, not an i18n key: the recipient has no account
    // yet, so there is no stored language to resolve one against, and a JSON key
    // in a customer's inbox is not a deferred translation (research D3).
    expect(body).toContain('Acme Industrial');
    expect(body).toContain('Hala@Example.COM');
    expect(body).toContain('ENGLISH');
    expect(body).toContain('العربية');
    // The anti-phishing line: it tells the reader what to do if they were not
    // expecting this, which is the difference between a trustworthy email and a
    // suspicious one.
    expect(body.toLowerCase()).toContain('not expecting');
  });

  it('writes no `messages` row — an invitation is not correspondence (research D3)', async () => {
    captureMail();
    const { customer, contact } = await makeCustomerWithEmail();

    await agent
      .post(`/api/customers/${customer.id}/contacts/${contact.id}/portal-invitations`)
      .send({});

    const { Message } = await import('../../src/models/index.js');
    expect(await Message.count()).toBe(0);
  });

  it('records who issued it (FR-002e)', async () => {
    captureMail();
    const { customer, contact } = await makeCustomerWithEmail();

    await agent
      .post(`/api/customers/${customer.id}/contacts/${contact.id}/portal-invitations`)
      .send({});

    const entry = await AuditLog.findOne({ where: { action: 'portal.invitation.issued' } });

    expect(entry).not.toBeNull();
    expect(entry?.actor_user_id).not.toBeNull();
  });

  it('warns about a provisional customer rather than refusing (FR-002f)', async () => {
    captureMail();
    const { customer, contact } = await makeCustomerWithEmail({ provisional: true });

    const response = await agent
      .post(`/api/customers/${customer.id}/contacts/${contact.id}/portal-invitations`)
      .send({});

    // Permitted, because forbidding it would leave every customer Phase 5
    // created automatically unable to ever use the portal — and flagged, because
    // nobody has verified that this address belongs to whoever the record claims.
    expect(response.status).toBe(201);
    expect(response.body.provisionalWarning).toBe(true);
  });

  it('is refused without portal:manage, server-side (FR-059)', async () => {
    const { agent: agentUser } = await agentAs('agent');
    const { customer, contact } = await makeCustomerWithEmail();

    const response = await agentUser
      .post(`/api/customers/${customer.id}/contacts/${contact.id}/portal-invitations`)
      .send({});

    expect(response.status).toBe(403);
    expect(await PortalInvitation.count()).toBe(0);
  });

  it('retires an outstanding invitation when a second is issued', async () => {
    const sent = captureMail();
    const { customer, contact } = await makeCustomerWithEmail();
    const url = `/api/customers/${customer.id}/contacts/${contact.id}/portal-invitations`;

    await agent.post(url).send({});
    await agent.post(url).send({});

    // Two live tokens for one contact would be two doors, and "I sent it again"
    // is the commonest reason for a second.
    const usable = await PortalInvitation.findAll({
      where: { customer_contact_id: contact.id, accepted_at: null, revoked_at: null },
    });

    expect(usable).toHaveLength(1);

    const firstToken = tokenFrom(sent[0]?.body ?? '');
    const stale = await supertest(app).get(`/api/portal/invitations/${firstToken}`);
    expect(stale.status).toBe(404);
  });
});

describe('accepting an invitation', () => {
  let agent: AuthedAgent;
  let token: string;
  let contactId: number;

  beforeEach(async () => {
    ({ agent } = await agentAs('admin'));
    const sent = captureMail();
    const { customer, contact } = await makeCustomerWithEmail();
    contactId = contact.id;

    await agent
      .post(`/api/customers/${customer.id}/contacts/${contact.id}/portal-invitations`)
      .send({});

    token = tokenFrom(sent[0]?.body ?? '');
  });

  it('shows the organisation and the address, and nothing else', async () => {
    const response = await supertest(app).get(`/api/portal/invitations/${token}`);

    expect(response.status).toBe(200);
    // The minimum a recipient needs to decide the email is genuine. Holding a
    // token is not being signed in.
    expect(Object.keys(response.body).sort()).toEqual(['email', 'organisationName', 'purpose']);
  });

  it('creates the account, signs the customer in, and binds it to the invited contact', async () => {
    const response = await supertest(app)
      .post(`/api/portal/invitations/${token}/accept`)
      .send({ password: 'Str0ng-Passw0rd!2026', language: 'ar' });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeTruthy();

    const account = await PortalAccount.findOne({ where: { customer_contact_id: contactId } });
    expect(account).not.toBeNull();
    expect(account?.preferred_language).toBe('ar');
  });

  it('cannot be used twice (FR-002b, SC-026)', async () => {
    await supertest(app)
      .post(`/api/portal/invitations/${token}/accept`)
      .send({ password: 'Str0ng-Passw0rd!2026' });

    const replay = await supertest(app)
      .post(`/api/portal/invitations/${token}/accept`)
      .send({ password: 'Different-Passw0rd!2026' });

    expect(replay.status).toBe(404);
    expect(await PortalAccount.count()).toBe(1);
  });

  /**
   * THE UNIFORMITY TEST (FR-002c, SC-026).
   *
   * Four causes, and the assertion is that their responses are BYTE-IDENTICAL to
   * each other — captured from a live request rather than hardcoded, so the
   * comparison survives a change to the error shape.
   */
  it('refuses expired, spent, revoked, and unknown tokens identically', async () => {
    const neverExisted = await supertest(app).get('/api/portal/invitations/not-a-real-token');

    // Spent.
    await supertest(app)
      .post(`/api/portal/invitations/${token}/accept`)
      .send({ password: 'Str0ng-Passw0rd!2026' });
    const spent = await supertest(app).get(`/api/portal/invitations/${token}`);

    // Expired.
    const sent2 = captureMail();
    const second = await makeCustomerWithEmail();
    await agent
      .post(`/api/customers/${second.customer.id}/contacts/${second.contact.id}/portal-invitations`)
      .send({});
    const expiredToken = tokenFrom(sent2[sent2.length - 1]?.body ?? '');
    await PortalInvitation.update(
      { expires_at: new Date(Date.now() - 1_000) },
      { where: { customer_contact_id: second.contact.id } },
    );
    const expired = await supertest(app).get(`/api/portal/invitations/${expiredToken}`);

    // Revoked.
    const sent3 = captureMail();
    const third = await makeCustomerWithEmail();
    await agent
      .post(`/api/customers/${third.customer.id}/contacts/${third.contact.id}/portal-invitations`)
      .send({});
    const revokedToken = tokenFrom(sent3[sent3.length - 1]?.body ?? '');
    const invitation = await PortalInvitation.findOne({
      where: { customer_contact_id: third.contact.id },
    });
    await agent.delete(`/api/admin/portal/invitations/${invitation?.id}`);
    const revoked = await supertest(app).get(`/api/portal/invitations/${revokedToken}`);

    for (const response of [spent, expired, revoked]) {
      expect(response.status).toBe(neverExisted.status);
      expect(response.body).toEqual(neverExisted.body);
    }
  });

  it('never stores the token itself', async () => {
    const rows = await PortalInvitation.findAll();

    expect(rows).toHaveLength(1);
    // A leaked copy of this table must not be a list of live invitations.
    expect(rows[0]?.token_hash).not.toBe(token);
    expect(rows[0]?.token_hash).toHaveLength(64);
  });

  it('refuses a password that fails the staff policy (FR-004)', async () => {
    const response = await supertest(app)
      .post(`/api/portal/invitations/${token}/accept`)
      .send({ password: 'short' });

    expect(response.status).toBe(400);
    expect(await PortalAccount.count()).toBe(0);
  });
});
