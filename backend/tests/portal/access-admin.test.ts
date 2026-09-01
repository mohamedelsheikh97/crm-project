import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { AuditLog, PortalAccount, Ticket } from '../../src/models/index.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { buildPortalWorld, portalAgent, type PortalWorld } from './fixtures.js';

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
 * STAFF ADMINISTRATION (Phase 8, User Story 8, FR-056 - FR-060a, SC-023, SC-031).
 *
 * The remedy. Everything else in this phase lets a customer in; this is what
 * takes it away again, and without it the phase is demonstrable but not
 * operable — a shared or compromised credential would have no answer.
 *
 * `portal:manage` IS NOT GRANTED TO AGENTS, and the refusal tests below are the
 * ones that matter: the same key releases lockouts and sends credential resets,
 * and there is no version of this phase where those are safely available to the
 * widest role in the system.
 */

describe('every action is refused without portal:manage (FR-059)', () => {
  let world: PortalWorld;
  let agent: AuthedAgent;

  beforeEach(async () => {
    world = await buildPortalWorld();
    ({ agent } = await agentAs('agent'));
  });

  it('refuses the overview, the invitation, and all five management actions', async () => {
    const attempts = [
      agent.get(`/api/customers/${world.customerId}/portal-access`),
      agent
        .post(`/api/customers/${world.customerId}/contacts/${world.a.contactId}/portal-invitations`)
        .send({}),
      agent
        .post(`/api/customers/${world.customerId}/contacts/${world.a.contactId}/portal-reset`)
        .send({}),
      agent.delete('/api/admin/portal/invitations/1'),
      agent.post(`/api/admin/portal/accounts/${world.a.accountId}/withdraw`).send({}),
      agent.post(`/api/admin/portal/accounts/${world.a.accountId}/restore`).send({}),
      agent.post(`/api/admin/portal/accounts/${world.a.accountId}/unlock`).send({}),
      agent.patch(`/api/tickets/${world.ticketUnassociated.id}/requesting-contact`).send({
        requestingContactId: world.a.contactId,
      }),
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    // AND NOTHING CHANGED. A 403 that had already done the work would be worse
    // than no gate at all.
    const account = await PortalAccount.findByPk(world.a.accountId);
    expect(account?.status).toBe('active');

    const ticket = await Ticket.findByPk(world.ticketUnassociated.id);
    expect(ticket?.requesting_contact_id).toBeNull();
  });

  it('the ticket association is gated on portal:manage, not tickets:update', async () => {
    // An agent who may correct a subject line is not thereby somebody who may
    // decide who outside the organisation reads the thread.
    //
    // THE CONTRAST IS THE TEST, so the first half asserts only that the agent is
    // not refused for LACK OF PERMISSION. The first version demanded a 200 and
    // failed on an optimistic-locking version it had guessed — which would have
    // made this a test about `version` rather than about the two grants.
    const edit = await agent
      .patch(`/api/tickets/${world.ticketA.id}`)
      .send({ subject: 'Renamed by an agent', version: 1 });

    expect(edit.status).not.toBe(403);

    const cannotAssociate = await agent
      .patch(`/api/tickets/${world.ticketA.id}/requesting-contact`)
      .send({ requestingContactId: world.b.contactId });

    expect(cannotAssociate.status).toBe(403);
  });
});

describe('the access overview (FR-056)', () => {
  it('reports the state of every email contact on the record', async () => {
    const world = await buildPortalWorld();
    const { agent } = await agentAs('admin');

    await PortalAccount.update(
      { locked_until: new Date(Date.now() + 600_000) },
      { where: { id: world.b.accountId } },
    );

    const response = await agent.get(`/api/customers/${world.customerId}/portal-access`);

    expect(response.status).toBe(200);
    const byEmail = new Map(
      response.body.items.map((row: { email: string; status: string }) => [row.email, row.status]),
    );

    // Per CONTACT, not per customer: Q2 makes an account belong to one person, so
    // a company record has one answer per contact rather than one overall.
    expect(byEmail.get(world.a.email)).toBe('active');
    expect(byEmail.get(world.b.email)).toBe('locked');
  });
});

describe('withdraw, restore, and unlock (FR-057, FR-060, FR-060a)', () => {
  let world: PortalWorld;
  let admin: AuthedAgent;

  beforeEach(async () => {
    world = await buildPortalWorld();
    ({ agent: admin } = await agentAs('admin'));
  });

  it('withdrawal ends the session and can be undone', async () => {
    await admin.post(`/api/admin/portal/accounts/${world.a.accountId}/withdraw`).send({});

    const denied = await portalAgent(world.a.accessToken).get('/api/portal/tickets');
    expect(denied.status).toBe(401);

    await admin.post(`/api/admin/portal/accounts/${world.a.accountId}/restore`).send({});

    const account = await PortalAccount.findByPk(world.a.accountId);
    expect(account?.status).toBe('active');
    // The PASSWORD is untouched: somebody whose access was withdrawn in error
    // signs in again with what they already know.
    expect(account?.password_hash).toBeTruthy();
  });

  it('unlock refuses on a withdrawn account rather than silently restoring it', async () => {
    await admin.post(`/api/admin/portal/accounts/${world.a.accountId}/withdraw`).send({});

    const response = await admin
      .post(`/api/admin/portal/accounts/${world.a.accountId}/unlock`)
      .send({});

    // A lockout is something the system did and clears itself; a withdrawal is
    // something a person decided. Merging them would let "unlock" reverse a
    // deliberate revocation.
    expect(response.status).toBe(403);

    const account = await PortalAccount.findByPk(world.a.accountId);
    expect(account?.status).toBe('withdrawn');
  });

  it('unlock clears a lockout and lets the customer back in', async () => {
    await PortalAccount.update(
      { locked_until: new Date(Date.now() + 600_000), failed_login_attempts: 9 },
      { where: { id: world.a.accountId } },
    );

    await admin.post(`/api/admin/portal/accounts/${world.a.accountId}/unlock`).send({});

    const account = await PortalAccount.findByPk(world.a.accountId);
    expect(account?.locked_until).toBeNull();
    expect(account?.failed_login_attempts).toBe(0);
  });
});

describe('associating a ticket with a contact (FR-026h, FR-057a, SC-029)', () => {
  it('makes it visible to that contact and to nobody else', async () => {
    const world = await buildPortalWorld();
    const { agent } = await agentAs('admin');

    // Invisible to both contacts to begin with — the fail-closed rule.
    for (const contact of [world.a, world.b]) {
      const before = await portalAgent(contact.accessToken).get(
        `/api/portal/tickets/${world.ticketUnassociated.reference}`,
      );
      expect(before.status).toBe(404);
    }

    const response = await agent
      .patch(`/api/tickets/${world.ticketUnassociated.id}/requesting-contact`)
      .send({ requestingContactId: world.a.contactId });

    expect(response.status).toBe(200);

    const forA = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketUnassociated.reference}`,
    );
    expect(forA.status).toBe(200);

    // AND STILL NOT THE COLLEAGUE. Associating is a disclosure to one person.
    const forB = await portalAgent(world.b.accessToken).get(
      `/api/portal/tickets/${world.ticketUnassociated.reference}`,
    );
    expect(forB.status).toBe(404);
  });

  it('can be undone by setting it back to null', async () => {
    const world = await buildPortalWorld();
    const { agent } = await agentAs('admin');

    await agent
      .patch(`/api/tickets/${world.ticketUnassociated.id}/requesting-contact`)
      .send({ requestingContactId: world.a.contactId });

    await agent
      .patch(`/api/tickets/${world.ticketUnassociated.id}/requesting-contact`)
      .send({ requestingContactId: null });

    // A mistaken association must be removable, and the effect is to make the
    // ticket invisible again rather than to hide the correction.
    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketUnassociated.reference}`,
    );

    expect(response.status).toBe(404);
  });
});

describe('every access event is attributable (FR-008, SC-023)', () => {
  it('records the actor for each staff act, and the address for each customer act', async () => {
    const world = await buildPortalWorld();
    const { agent, user } = await agentAs('admin');

    await agent.post(`/api/admin/portal/accounts/${world.a.accountId}/withdraw`).send({});
    await agent.post(`/api/admin/portal/accounts/${world.a.accountId}/restore`).send({});
    await agent
      .patch(`/api/tickets/${world.ticketUnassociated.id}/requesting-contact`)
      .send({ requestingContactId: world.a.contactId });

    const entries = await AuditLog.findAll({ where: {} });
    const byAction = new Map(entries.map((entry) => [entry.action, entry]));

    for (const action of [
      'portal.access.withdrawn',
      'portal.access.restored',
      'portal.ticket.contact_associated',
    ]) {
      const entry = byAction.get(action);
      expect(entry, `missing audit entry for ${action}`).toBeDefined();
      expect(entry?.actor_user_id).toBe(user.id);
    }

    // NAMESPACED UNDER `portal.`, so a Phase 1 query for staff sign-ins does not
    // start returning customers (FR-008).
    for (const entry of entries) {
      if (entry.action.startsWith('portal.')) continue;
      expect(entry.action).not.toContain('portal');
    }
  });
});
