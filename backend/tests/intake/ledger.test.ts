import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { ChannelIntake, Message, Ticket } from '../../src/models/index.js';
import { INTAKE_STATUSES } from '../../src/models/channel-intake.model.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { deliverEmail, seedCustomerWithEmail } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  // The loop bound is per-process memory and would otherwise leak between
  // cases, silently ignoring messages in a test that never mentions rate limits.
  resetRateLimit();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * US1 — the intake ledger (research.md D13).
 *
 * One table carrying three requirements: idempotency (FR-039, FR-094),
 * nothing-is-lost retention (FR-037, FR-038), and the intake audit trail
 * (FR-101). SC-009 and SC-010.
 */
describe('the ledger records every accepted delivery (FR-095)', () => {
  it('creates a ticket, a message, and a converted ledger row', async () => {
    const customer = await seedCustomerWithEmail('hala@example.com');

    const outcome = await deliverEmail({
      messageId: '<first@example.com>',
      from: 'hala@example.com',
      subject: 'Invoice not received',
      body: 'I have not had the invoice yet.',
    });

    expect(outcome.status).toBe('converted');

    const ticket = await Ticket.findOne({ where: { customer_id: customer.id } });

    expect(ticket).not.toBeNull();
    expect(ticket?.subject).toBe('Invoice not received');
    // FR-026: the system raised it, and says so two ways.
    expect(ticket?.source).toBe('email');
    expect(ticket?.created_by_user_id).toBeNull();
    // FR-027: intake never assigns. Assignment stays Supervisor-only.
    expect(ticket?.assignee_user_id).toBeNull();

    const ledger = await ChannelIntake.findOne({
      where: { provider_message_id: '<first@example.com>' },
    });

    expect(ledger?.status).toBe(INTAKE_STATUSES.CONVERTED);
    expect(ledger?.message_id).not.toBeNull();
    // The payload is retained even on success, so a bug is diagnosable.
    expect(ledger?.raw_payload).toContain('hala@example.com');
  });

  it('is idempotent: the same delivery twice makes one ticket (SC-009)', async () => {
    await seedCustomerWithEmail('hala@example.com');

    const payload = {
      messageId: '<same@example.com>',
      from: 'hala@example.com',
      subject: 'Hello',
      body: 'Hello',
    };

    const first = await deliverEmail(payload);
    const second = await deliverEmail(payload);

    expect(first.status).toBe('converted');
    // Not an error. A provider retrying is the ordinary case.
    expect(second.status).toBe('duplicate');

    expect(await Ticket.count()).toBe(1);
    expect(await Message.count()).toBe(1);
    expect(await ChannelIntake.count()).toBe(1);
  });

  it('reports the existing ticket on a duplicate, rather than nothing', async () => {
    await seedCustomerWithEmail('hala@example.com');

    const payload = { messageId: '<dup@example.com>', from: 'hala@example.com', body: 'Hi' };

    const first = await deliverEmail(payload);
    const second = await deliverEmail(payload);

    expect(first.status).toBe('converted');
    expect(second.status).toBe('duplicate');

    if (first.status === 'converted' && second.status === 'duplicate') {
      expect(second.ticketId).toBe(first.ticketId);
    }
  });

  it('keeps the same provider id on two different channels apart', async () => {
    // The unique index is on (channel, provider_message_id). Two providers
    // numbering their events from 1 must not collide.
    await seedCustomerWithEmail('hala@example.com');

    await deliverEmail({ messageId: 'shared-id-1', from: 'hala@example.com', body: 'Email' });

    await ChannelIntake.create({
      channel: 'sms',
      provider_message_id: 'shared-id-1',
      received_at: new Date(),
      status: INTAKE_STATUSES.PENDING,
      raw_payload: '{}',
      attempts: 1,
    });

    expect(await ChannelIntake.count()).toBe(2);
  });

  it('creates a provisional customer for an unrecognised sender (SC-016)', async () => {
    const outcome = await deliverEmail({
      messageId: '<stranger@example.com>',
      from: 'stranger@example.com',
      subject: 'Who are you',
      body: 'A question from nobody we know.',
    });

    expect(outcome.status).toBe('converted');

    const ticket = await Ticket.findOne();
    const { Customer } = await import('../../src/models/index.js');
    const customer = await Customer.findByPk(ticket?.customer_id ?? 0);

    // A message is NEVER left without a customer (research D7).
    expect(customer).not.toBeNull();
    expect(customer?.is_provisional).toBe(true);
  });

  it('captures a message for an inactive customer (FR-018)', async () => {
    const customer = await seedCustomerWithEmail('gone@example.com');
    customer.is_active = false;
    await customer.save();

    const outcome = await deliverEmail({
      messageId: '<inactive@example.com>',
      from: 'gone@example.com',
      body: 'Still a real question.',
    });

    expect(outcome.status).toBe('converted');

    const ticket = await Ticket.findOne();

    // Attached to the real customer, not to a new provisional one.
    expect(ticket?.customer_id).toBe(customer.id);
  });
});

describe('nothing accepted is lost (FR-037, FR-038, SC-010)', () => {
  it('retains a failed delivery with its reason and payload', async () => {
    // A body over the column limit is the simplest genuine failure to force:
    // it gets past validation and dies at the write.
    const outcome = await deliverEmail({
      messageId: '<broken@example.com>',
      from: 'stranger@example.com',
      subject: 'x'.repeat(10),
      // MEDIUMTEXT holds 16MB; this exceeds the connection's max_allowed_packet.
      body: 'x'.repeat(20_000_000),
    });

    expect(outcome.status).toBe('failed');

    const ledger = await ChannelIntake.findOne({
      where: { provider_message_id: '<broken@example.com>' },
    });

    // The row survives, with a reason, so an administrator can see it.
    expect(ledger).not.toBeNull();
    expect(ledger?.status).toBe(INTAKE_STATUSES.FAILED);
    expect(ledger?.reason).toBeTruthy();
    expect(await Message.count()).toBe(0);
  });

  it('records a subject for a channel that has none, from the first line', async () => {
    // Five queue rows all reading "SMS message" is a queue nobody can triage.
    await seedCustomerWithEmail('hala@example.com');

    await deliverEmail({
      messageId: '<nosubject@example.com>',
      from: 'hala@example.com',
      subject: '',
      body: 'The card reader keeps rebooting\n\nIt happens every morning.',
    });

    const ticket = await Ticket.findOne();

    expect(ticket?.subject).toBe('The card reader keeps rebooting');
  });
});
