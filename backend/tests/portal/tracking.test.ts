import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildInboundSubmission } from '../../src/channels/form/inbound.js';
import { sequelize } from '../../src/config/database.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { CustomerContact, Message, Ticket } from '../../src/models/index.js';
import { CUSTOMER_STATES, customerStateFor } from '../../src/portal/customer-status.js';
import * as intakeService from '../../src/services/intake.service.js';
import * as ticketService from '../../src/services/ticket.service.js';
import { TICKET_STATUSES } from '../../src/tickets/lifecycle.js';
import { agentAs } from '../helpers/auth.js';
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
 * TRACKING, AND WHERE THE ASSOCIATION COMES FROM (Phase 8, User Story 3,
 * FR-026a - FR-026i, FR-027, FR-028).
 *
 * The list itself is the easy half. The hard half is that a ticket has to KNOW
 * which contact raised it, at all four points a ticket is born — and this file
 * checks each of them, because a write site that forgets produces a request the
 * customer who raised it cannot see, silently.
 */

describe('the customer state mapping (FR-028, research D7)', () => {
  it('covers every status in the lifecycle, with no fallback', () => {
    // A TOTAL function. Adding a seventh status without extending the mapping is
    // a type error rather than a runtime default that would mis-describe it to
    // every customer.
    for (const status of TICKET_STATUSES) {
      const view = customerStateFor(status);
      expect(CUSTOMER_STATES).toContain(view.state);
    }
  });

  it('collapses open and escalated deliberately', () => {
    // NOT injective, and it must not be made so: the difference is the
    // organisation's internal posture, and a customer who can see it will ask
    // "escalated to whom?".
    expect(customerStateFor('open').state).toBe('in_progress');
    expect(customerStateFor('escalated').state).toBe('in_progress');
  });

  it('offers a rating only where the work is finished', () => {
    expect(customerStateFor('resolved').ratingOffered).toBe(true);
    expect(customerStateFor('closed').ratingOffered).toBe(true);
    expect(customerStateFor('open').ratingOffered).toBe(false);
    expect(customerStateFor('pending').ratingOffered).toBe(false);
  });
});

describe('the request list (FR-027)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  it('shows reference, subject, a customer state, and the times', async () => {
    const response = await portalAgent(world.a.accessToken).get('/api/portal/tickets');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.items[0]).sort()).toEqual([
      'isSettled',
      'lastChangedAt',
      'raisedAt',
      'reference',
      'state',
      'subject',
    ]);
  });

  it('never exposes an internal status string', async () => {
    await Ticket.update({ status: 'escalated' }, { where: { id: world.ticketA.id } });

    const response = await portalAgent(world.a.accessToken).get('/api/portal/tickets');

    expect(response.body.items[0].state).toBe('in_progress');
    expect(JSON.stringify(response.body)).not.toContain('escalated');
  });

  it('excludes a merged-away request, so one conversation is one entry', async () => {
    const survivor = await Ticket.create({
      customer_id: world.customerId,
      subject: 'The surviving request',
      description: null,
      category: 'general',
      priority: 'normal',
      status: 'open',
      assignee_user_id: null,
      created_by_user_id: null,
      source: 'portal',
      requesting_contact_id: world.a.contactId,
    });

    await Ticket.update(
      { merged_into_ticket_id: survivor.id },
      { where: { id: world.ticketA.id } },
    );

    const response = await portalAgent(world.a.accessToken).get('/api/portal/tickets');
    const references = response.body.items.map((item: { reference: string }) => item.reference);

    expect(references).not.toContain(world.ticketA.reference);
  });

  it('resolves a merged-away reference to the survivor (FR-032)', async () => {
    const survivor = await Ticket.create({
      customer_id: world.customerId,
      subject: 'The surviving request',
      description: null,
      category: 'general',
      priority: 'normal',
      status: 'open',
      assignee_user_id: null,
      created_by_user_id: null,
      source: 'portal',
      requesting_contact_id: world.a.contactId,
    });

    await Ticket.update(
      { merged_into_ticket_id: survivor.id },
      { where: { id: world.ticketA.id } },
    );

    // The customer holds the OLD reference. They must not hit a dead end.
    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.subject).toBe('The surviving request');
  });

  it('refuses a merged-away reference whose SURVIVOR belongs to a colleague (FR-026j)', async () => {
    // The trap: following a redirect without re-applying the scope would make a
    // merge a way to hand somebody a conversation they could not otherwise see.
    await Ticket.update(
      { merged_into_ticket_id: world.ticketB.id },
      { where: { id: world.ticketA.id } },
    );

    const response = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}`,
    );

    expect(response.status).toBe(404);
  });
});

describe('where the contact association comes from (FR-026b - FR-026e)', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
  });

  it('an inbound message records the contact it resolved to (FR-026c)', async () => {
    const outcome = await intakeService.accept(
      {
        channel: 'email',
        providerMessageId: 'tracking-inbound-1',
        senderIdentity: world.a.email,
        recipientIdentity: 'support@example.com',
        subject: 'My card reader',
        body: 'It is offline again.',
        bodyFormat: 'text',
        attachments: [],
        occurredAt: new Date(),
        threadHints: {
          inReplyTo: null,
          references: [],
          addressToken: null,
          providerConversationId: null,
        },
        isAutomated: false,
        isOptOut: false,
      },
      '{}',
    );

    expect(outcome.status).toBe('converted');

    const ticket = await Ticket.findByPk((outcome as { ticketId: number }).ticketId);
    expect(ticket?.requesting_contact_id).toBe(world.a.contactId);

    // And therefore visible to that contact, and to nobody else on the record.
    const list = await portalAgent(world.a.accessToken).get('/api/portal/tickets');
    expect(list.body.items.map((item: { subject: string }) => item.subject)).toContain(
      'My card reader',
    );
  });

  it('a public form submission records the contact matching the address (FR-026d)', async () => {
    const outcome = await intakeService.accept(
      buildInboundSubmission({
        submissionId: 'tracking-form-1',
        senderIdentity: world.a.email,
        formTitle: 'Report a fault',
        answers: [{ label: 'What is wrong?', value: 'The reader is offline.' }],
      }),
      '{}',
    );

    const ticket = await Ticket.findByPk((outcome as { ticketId: number }).ticketId);

    // The form path shares intake's creation path, so one change covered both
    // write sites. Asserted anyway: sharing a path is not the same as being
    // certain it stayed shared.
    expect(ticket?.requesting_contact_id).toBe(world.a.contactId);
  });

  it('an agent-created ticket may carry no association at all (FR-026e)', async () => {
    const { user } = await agentAs('admin');

    const created = await ticketService.create(
      {
        customerId: world.customerId,
        subject: 'Raised during a phone call',
        description: 'The caller did not say which address they use.',
        category: 'general',
        priority: 'normal',
      },
      { id: user.id, email: user.email, fullName: user.full_name, roleId: user.role_id },
    );

    const ticket = await Ticket.findByPk(created.id);
    expect(ticket?.requesting_contact_id).toBeNull();

    // AND IS THEREFORE INVISIBLE IN THE PORTAL (FR-026f) — the fail-closed rule,
    // whose visible cost is exactly this.
    const list = await portalAgent(world.a.accessToken).get('/api/portal/tickets');
    expect(list.body.items.map((item: { subject: string }) => item.subject)).not.toContain(
      'Raised during a phone call',
    );
  });

  it('refuses a contact belonging to another customer (FR-026h)', async () => {
    const foreign = await CustomerContact.create({
      customer_id: world.otherCustomerId,
      kind: 'email',
      value_raw: 'someone@beta.test.local',
      value_normalised: 'someone@beta.test.local',
      is_primary: false,
    });

    const { agent } = await agentAs('admin');

    const response = await agent
      .patch(`/api/tickets/${world.ticketUnassociated.id}/requesting-contact`)
      .send({ requestingContactId: foreign.id });

    // An association across customers would make one customer's conversation
    // visible in another customer's portal.
    expect(response.status).toBe(400);

    const ticket = await Ticket.findByPk(world.ticketUnassociated.id);
    expect(ticket?.requesting_contact_id).toBeNull();
  });
});

describe('the deterministic backfill (FR-026g, research D4)', () => {
  /**
   * Runs the migration's own condition rather than a copy of it, so this test
   * cannot pass while the migration is wrong. The migration is already applied by
   * `setupTestDatabase`, so what is exercised here is the SQL against fixtures
   * built afterwards — which is the part that has to be right.
   */
  const migration = () =>
    import('../../src/db/migrations/20260901000011-backfill-ticket-requesting-contact.cjs');

  async function runBackfill(): Promise<void> {
    const { default: definition } = (await migration()) as {
      default: { up: (qi: unknown) => Promise<void> };
    };
    await definition.up(sequelize.getQueryInterface());
  }

  async function inboundOn(ticketId: number, address: string): Promise<void> {
    await Message.create({
      ticket_id: ticketId,
      channel: 'email',
      direction: 'inbound',
      author_user_id: null,
      sender_identity: address,
      sender_identity_normalised: address.toLowerCase(),
      body: 'The original message.',
      body_format: 'text',
      provider_message_id: `backfill-${ticketId}`,
      outbound_message_id: null,
      delivery_state: 'delivered',
      delivery_detail: null,
      occurred_at: new Date(),
    });
  }

  it('associates on an exact single match', async () => {
    const world = await buildPortalWorld();
    await inboundOn(world.ticketUnassociated.id, world.a.email);

    await runBackfill();

    const ticket = await Ticket.findByPk(world.ticketUnassociated.id);
    expect(ticket?.requesting_contact_id).toBe(world.a.contactId);
  });

  it('DECLINES when two contacts on the record share the address', async () => {
    const world = await buildPortalWorld();

    // Phase 2's duplicate handling permits this, so the backfill has to meet it.
    await CustomerContact.create({
      customer_id: world.customerId,
      kind: 'email',
      value_raw: world.a.email,
      value_normalised: world.a.email.toLowerCase(),
      is_primary: false,
    });

    await inboundOn(world.ticketUnassociated.id, world.a.email);

    await runBackfill();

    const ticket = await Ticket.findByPk(world.ticketUnassociated.id);
    // "Probably this one" is not good enough when being wrong is a disclosure.
    expect(ticket?.requesting_contact_id).toBeNull();
  });

  it('leaves a ticket with no inbound message alone', async () => {
    const world = await buildPortalWorld();

    await runBackfill();

    const ticket = await Ticket.findByPk(world.ticketUnassociated.id);
    expect(ticket?.requesting_contact_id).toBeNull();
  });

  it('never overwrites an existing association, and is idempotent', async () => {
    const world = await buildPortalWorld();
    // An inbound message from B on a ticket already associated with A — a
    // colleague forwarding, or replying on someone else's behalf.
    await inboundOn(world.ticketA.id, world.b.email);

    await runBackfill();
    await runBackfill();

    const ticket = await Ticket.findByPk(world.ticketA.id);
    expect(ticket?.requesting_contact_id).toBe(world.a.contactId);
  });
});
