import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as outbox from '../../src/integrations/outbox.js';
import { sequelize } from '../../src/config/database.js';
import { Customer, IntegrationEvent } from '../../src/models/index.js';
import * as customerService from '../../src/services/customer.service.js';
import * as ticketService from '../../src/services/ticket.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

/**
 * A payload carries IDENTIFIERS, NEVER RECORD CONTENT (Phase 11, US2, FR-028).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A SEARCH, NOT A REVIEW.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "No record content in the payload" is the kind of requirement that holds on
 * the day it is written and erodes the first time somebody finds it convenient
 * to add a subject line "so the receiver does not have to fetch". So the fixture
 * uses DISTINCTIVE strings — a subject, a body, a customer name nobody would
 * write by accident — and every generated payload is searched for them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT MATTERS, IN TWO PARTS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * AUTHORITY. A notification goes to an address a person typed into a form. If
 * that address is wrong, or is later taken over, a payload carrying customer
 * names and ticket bodies is a data disclosure — while a payload carrying an
 * identifier is an inconvenience. Sending identifiers means authority is checked
 * at READ time, against the credential doing the reading, by the same services
 * that check it for everyone else.
 *
 * TRUTH. Delivery is at-least-once and unordered (FR-031, FR-032), so a snapshot
 * in a payload can arrive after the record has changed again — and the receiver
 * has no way to tell. An identifier is never stale.
 */
const FORBIDDEN = {
  subject: 'ZZQX-CONFIDENTIAL-SUBJECT-LINE',
  body: 'ZZQX-CONFIDENTIAL-TICKET-BODY-TEXT',
  customerName: 'ZZQX-CONFIDENTIAL-CUSTOMER-NAME',
  email: 'zzqx-confidential@example.invalid',
} as const;

describe('notification payload content', () => {
  let ticketActor: { id: number; email: string; fullName: string; roleId: number };
  let customerActor: { id: number; email: string };

  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();

    const user = await createTestUser({ roleKey: 'admin' });

    ticketActor = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      roleId: user.role_id,
    };
    customerActor = { id: user.id, email: user.email };
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  /** Every payload in the database, as one searchable string. */
  async function allPayloads(): Promise<string> {
    const events = await IntegrationEvent.findAll();

    expect(events.length, 'no events were generated, so this proves nothing').toBeGreaterThan(0);

    return JSON.stringify(events.map((event) => event.payload));
  }

  it('carries no ticket subject or body', async () => {
    const customer = await Customer.create({
      display_name: FORBIDDEN.customerName,
      is_active: true,
    } as never);

    await ticketService.create(
      {
        customerId: customer.id,
        subject: FORBIDDEN.subject,
        description: FORBIDDEN.body,
        category: 'general',
        priority: 'normal',
      },
      ticketActor,
    );

    const payloads = await allPayloads();

    expect(payloads).not.toContain(FORBIDDEN.subject);
    expect(payloads).not.toContain(FORBIDDEN.body);
    expect(payloads).not.toContain(FORBIDDEN.customerName);
  });

  it('carries no customer name or contact detail', async () => {
    await customerService.create(
      {
        displayName: FORBIDDEN.customerName,
        contacts: [{ kind: 'email', value: FORBIDDEN.email }],
      } as never,
      customerActor,
    );

    const payloads = await allPayloads();

    expect(payloads).not.toContain(FORBIDDEN.customerName);
    expect(payloads).not.toContain(FORBIDDEN.email);
  });

  it('carries exactly the documented fields, and nothing else', async () => {
    await sequelize.transaction(async (transaction) => {
      await outbox.record(
        { eventType: 'ticket.created', subjectType: 'ticket', subjectId: 7 },
        transaction,
      );
    });

    const event = await IntegrationEvent.findOne();

    /**
     * A FIXED KEY SET, asserted exactly.
     *
     * Not "does not contain the forbidden strings" — that would pass for a
     * payload carrying a field nobody thought to forbid. The published contract
     * names five keys, and adding a sixth should be a visible change to this
     * assertion rather than something that slips through.
     */
    expect(Object.keys(event!.payload).sort()).toEqual([
      'api_version',
      'event_id',
      'event_type',
      'occurred_at',
      'subject',
    ]);

    expect(Object.keys(event!.payload.subject).sort()).toEqual(['id', 'type', 'url']);
  });

  it('gives the receiver a URL to read the record from', async () => {
    await sequelize.transaction(async (transaction) => {
      await outbox.record(
        { eventType: 'ticket.created', subjectType: 'ticket', subjectId: 7 },
        transaction,
      );
      await outbox.record(
        { eventType: 'customer.created', subjectType: 'customer', subjectId: 9 },
        transaction,
      );
    });

    const events = await IntegrationEvent.findAll({ order: [['id', 'ASC']] });

    /**
     * The cost of identifier-only payloads is one read per event, and this is
     * what makes that read cheap to find: the payload says where to look rather
     * than leaving the receiver to construct a path from a type name.
     */
    expect(events[0]!.payload.subject.url).toBe('/api/v1/tickets/7');
    expect(events[1]!.payload.subject.url).toBe('/api/v1/customers/9');
  });

  it('names the interface version, so a stored payload stays interpretable', async () => {
    await sequelize.transaction(async (transaction) => {
      await outbox.record(
        { eventType: 'ticket.created', subjectType: 'ticket', subjectId: 1 },
        transaction,
      );
    });

    const event = await IntegrationEvent.findOne();

    /**
     * A receiver that retains payloads needs to know which contract produced
     * them — otherwise a version-2 payload in the same table as a version-1 one
     * is indistinguishable, and they differ in exactly the ways versioning
     * exists to signal.
     */
    expect(event!.payload.api_version).toBe('1');
  });

  it('BITES — the search would find content if it were there', async () => {
    /**
     * Proving the assertion is not vacuous.
     *
     * A test that searched for strings the fixture never used would pass on any
     * payload at all. This confirms the distinctive values really are in the
     * database — just not in the payloads — so the absence above is a fact about
     * the payload rather than about the fixture.
     */
    const customer = await Customer.create({
      display_name: FORBIDDEN.customerName,
      is_active: true,
    } as never);

    await ticketService.create(
      {
        customerId: customer.id,
        subject: FORBIDDEN.subject,
        description: FORBIDDEN.body,
        category: 'general',
        priority: 'normal',
      },
      ticketActor,
    );

    const { Ticket } = await import('../../src/models/index.js');
    const stored = await Ticket.findOne();

    // The content IS in the system...
    expect(stored!.subject).toBe(FORBIDDEN.subject);
    expect(stored!.description).toBe(FORBIDDEN.body);

    // ...and NOT in what would be sent.
    expect(await allPayloads()).not.toContain(FORBIDDEN.subject);
  });
});
