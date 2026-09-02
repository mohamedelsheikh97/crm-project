import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import * as outbox from '../../src/integrations/outbox.js';
import { Customer, IntegrationEvent, Ticket } from '../../src/models/index.js';
import * as customerService from '../../src/services/customer.service.js';
import * as ticketService from '../../src/services/ticket.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

/**
 * The transactional outbox (Phase 11, US2, FR-024, FR-026, FR-028 - FR-031,
 * research D7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO ASYMMETRIC FAILURES, AND THE TRANSACTION RULES OUT BOTH.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Written BEFORE commit, then rolled back — a webhook fires for something
 *   that did not happen. The receiver creates a record for a ticket that does
 *   not exist, and no later event ever corrects it.
 *
 *   Written AFTER commit, in a separate step, and the process dies in between —
 *   the change happened and nobody is ever told. FR-030 and SC-013 forbid it.
 *
 * Inside the transaction, the event exists exactly when the change does. This
 * file asserts both directions, because a test that only checked "an event was
 * written" would pass for either broken design.
 */
describe('the transactional outbox', () => {
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

  it('requires a transaction — it cannot be called without one', () => {
    /**
     * THE MECHANISM, NOT A CONVENTION.
     *
     * `record(input, transaction)` takes the transaction as a required
     * parameter, so a caller who has none cannot call it. The guarantee above
     * therefore cannot be lost by somebody forgetting to pass one — it is a type
     * error rather than a silent behaviour change.
     */
    expect(outbox.record.length).toBe(2);
  });

  it('writes NOTHING when the transaction rolls back', async () => {
    const before = await IntegrationEvent.count();

    await expect(
      sequelize.transaction(async (transaction) => {
        await outbox.record(
          { eventType: 'ticket.created', subjectType: 'ticket', subjectId: 999 },
          transaction,
        );

        // The change fails after the event was recorded.
        throw new Error('the caller changed its mind');
      }),
    ).rejects.toThrow('the caller changed its mind');

    /**
     * A webhook firing for a rolled-back change is the failure this rules out.
     * The receiver would create a record for something that never happened, and
     * nothing would ever correct it.
     */
    expect(await IntegrationEvent.count()).toBe(before);
  });

  it('writes exactly one event when the transaction commits', async () => {
    await sequelize.transaction(async (transaction) => {
      await outbox.record(
        { eventType: 'ticket.created', subjectType: 'ticket', subjectId: 1 },
        transaction,
      );
    });

    const events = await IntegrationEvent.findAll();

    expect(events.length).toBe(1);
    expect(events[0]!.event_type).toBe('ticket.created');
    expect(events[0]!.subject_id).toBe(1);
  });

  it('records an event when a TICKET is created through the ordinary path', async () => {
    const customer = await Customer.create({ display_name: 'Outbox Co', is_active: true } as never);

    const ticket = await ticketService.create(
      {
        customerId: customer.id,
        subject: 'A ticket that should notify',
        category: 'general',
        priority: 'normal',
      },
      ticketActor,
    );

    const events = await IntegrationEvent.findAll({ where: { event_type: 'ticket.created' } });

    /**
     * Through `ticketService.create`, not by calling the outbox directly.
     *
     * FR-065 says this phase adds no new monitoring — it observes the emission
     * points Phases 3 and 6 already have. Asserting through the ordinary path is
     * what proves the observation is actually wired in rather than available.
     */
    expect(events.length).toBe(1);
    expect(events[0]!.subject_id).toBe(ticket.id);
    expect(events[0]!.subject_type).toBe('ticket');
  });

  it('records an event when a CUSTOMER is created through the ordinary path', async () => {
    const created = await customerService.create(
      {
        displayName: 'Notified Co',
        // At least one contact is required (Phase 2, FR-004): a customer nobody
        // can be reached at is not a customer record.
        contacts: [{ kind: 'email', value: 'notified@example.org' }],
      } as never,
      customerActor,
    );

    const events = await IntegrationEvent.findAll({ where: { event_type: 'customer.created' } });

    expect(events.length).toBe(1);
    expect(events[0]!.subject_id).toBe(created.id);
    expect(events[0]!.subject_type).toBe('customer');
  });

  it('records `ticket.resolved` on the TRANSITION, not on the state', async () => {
    const customer = await Customer.create({
      display_name: 'Resolve Co',
      is_active: true,
    } as never);

    const ticket = await ticketService.create(
      { customerId: customer.id, subject: 'To resolve', category: 'general', priority: 'normal' },
      ticketActor,
    );

    await Ticket.update({ status: 'open' }, { where: { id: ticket.id }, silent: true });

    const current = await Ticket.findByPk(ticket.id);

    await ticketService.transition(
      ticket.id,
      { to: 'resolved', version: current.version },
      ticketActor,
    );

    const resolved = await IntegrationEvent.findAll({
      where: { event_type: 'ticket.resolved', subject_id: ticket.id },
    });

    expect(resolved.length).toBe(1);
  });

  it('carries millisecond precision on `occurred_at` (FR-032)', async () => {
    /**
     * Load-bearing rather than tidy.
     *
     * FR-032 tells receivers to order events by occurrence time, because
     * delivery order is not guaranteed. Two events for one ticket inside a
     * second are ordinary — a status change that fires an automation rule — so
     * second precision would make that instruction unfollowable in exactly the
     * case where ordering matters most.
     */
    await sequelize.transaction(async (transaction) => {
      await outbox.record(
        {
          eventType: 'ticket.created',
          subjectType: 'ticket',
          subjectId: 1,
          occurredAt: new Date('2026-09-03T10:00:00.123Z'),
        },
        transaction,
      );
    });

    const event = await IntegrationEvent.findOne();

    expect(event!.payload.occurred_at).toBe('2026-09-03T10:00:00.123Z');

    // And in the column, not just the payload — the sweep and the overview both
    // order by it.
    const stored = new Date(event!.occurred_at);
    expect(stored.getUTCMilliseconds()).toBe(123);
  });

  it('gives every event a STABLE, unique key (FR-031)', async () => {
    await sequelize.transaction(async (transaction) => {
      await outbox.record(
        { eventType: 'ticket.created', subjectType: 'ticket', subjectId: 1 },
        transaction,
      );
      await outbox.record(
        { eventType: 'ticket.created', subjectType: 'ticket', subjectId: 1 },
        transaction,
      );
    });

    const events = await IntegrationEvent.findAll();

    expect(events.length).toBe(2);

    /**
     * Two events for the SAME subject get different keys, because they are
     * different occurrences. A receiver deduplicates on the key, so a key shared
     * between genuine occurrences would make it drop the second — and a ticket
     * resolved twice really was resolved twice.
     */
    expect(events[0]!.event_key).not.toBe(events[1]!.event_key);

    // And the key in the payload matches the column, so a receiver reading
    // either sees the same value.
    for (const event of events) {
      expect(event.payload.event_id).toBe(event.event_key);
    }
  });
});
