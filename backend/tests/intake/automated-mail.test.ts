import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toInboundMessage } from '../../src/channels/email/imap-smtp.js';
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
  resetRateLimit();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * US1 — automated mail and loop prevention (FR-029, FR-030, SC-011).
 *
 * The failure this prevents is not theoretical: our reply triggers a vacation
 * responder, whose reply triggers ours, and a queue fills with hundreds of
 * tickets in minutes.
 */

function rawMail(headers: string, body = 'Automatic response.'): Buffer {
  return Buffer.from(
    [
      'From: someone@example.com',
      'To: support@example.com',
      'Subject: Out of office',
      headers,
      '',
      body,
    ]
      .filter((line) => line !== '')
      .join('\r\n'),
  );
}

describe('automated mail is detected by header, never by subject text (research D12)', () => {
  // Subject matching would be language-dependent, and this project is
  // bilingual by constitution. RFC 3834 exists so this is not guesswork.
  it('detects Auto-Submitted', async () => {
    const message = await toInboundMessage(rawMail('Auto-Submitted: auto-replied'));
    expect(message.isAutomated).toBe(true);
  });

  it('does NOT treat Auto-Submitted: no as automated', async () => {
    const message = await toInboundMessage(rawMail('Auto-Submitted: no'));
    expect(message.isAutomated).toBe(false);
  });

  it('detects Precedence: bulk, list and junk', async () => {
    for (const value of ['bulk', 'list', 'junk']) {
      const message = await toInboundMessage(rawMail(`Precedence: ${value}`));
      expect(message.isAutomated, `failed for ${value}`).toBe(true);
    }
  });

  it('detects X-Auto-Response-Suppress', async () => {
    const message = await toInboundMessage(rawMail('X-Auto-Response-Suppress: All'));
    expect(message.isAutomated).toBe(true);
  });

  it('detects an empty return path, which is how a bounce announces itself', async () => {
    const message = await toInboundMessage(rawMail('Return-Path: <>'));
    expect(message.isAutomated).toBe(true);
  });

  it('leaves ordinary mail alone', async () => {
    const message = await toInboundMessage(
      rawMail('X-Mailer: Some Client 4.2', 'A genuine question from a person.'),
    );

    expect(message.isAutomated).toBe(false);
  });

  it('does not treat an Arabic out-of-office subject as a signal on its own', async () => {
    // If detection were subject-based, this would be a miss in one language and
    // a false positive in the other.
    const raw = Buffer.from(
      [
        'From: someone@example.com',
        'To: support@example.com',
        'Subject: =?UTF-8?B?2LHYryDYqtmE2YLYp9im2Yo=?=',
        '',
        'A real message that happens to have that subject.',
      ].join('\r\n'),
    );

    const message = await toInboundMessage(raw);

    expect(message.isAutomated).toBe(false);
  });
});

describe('automated mail creates nothing (FR-029)', () => {
  it('is recorded as IGNORED, not FAILED, and raises no ticket', async () => {
    // The distinction matters: an administrator reviewing failures must not
    // have to wade through correctly-handled out-of-office replies to find the
    // genuine problem a customer is waiting on.
    await seedCustomerWithEmail('hala@example.com');

    const outcome = await deliverEmail({
      messageId: '<ooo@example.com>',
      from: 'hala@example.com',
      subject: 'Out of office',
      body: 'I am away until Monday.',
      automated: true,
    });

    expect(outcome).toEqual({ status: 'ignored', reason: 'automated_mail' });

    expect(await Ticket.count()).toBe(0);
    expect(await Message.count()).toBe(0);

    const ledger = await ChannelIntake.findOne();
    expect(ledger?.status).toBe(INTAKE_STATUSES.IGNORED);
    expect(ledger?.status).not.toBe(INTAKE_STATUSES.FAILED);
    expect(ledger?.reason).toBe('automated_mail');
  });
});

describe('the loop bound engages and is recorded (FR-030)', () => {
  it('stops converting after the per-sender bound, without affecting others', async () => {
    await seedCustomerWithEmail('loud@example.com');
    await seedCustomerWithEmail('quiet@example.com', 'Quiet');

    const { env } = await import('../../src/config/env.js');
    const bound = env.INTAKE_RATE_PER_MINUTE;

    let ignored = 0;

    for (let i = 0; i <= bound + 1; i += 1) {
      const outcome = await deliverEmail({
        messageId: `<loop-${i}@example.com>`,
        from: 'loud@example.com',
        body: `Message ${i}`,
      });

      if (outcome.status === 'ignored') ignored += 1;
    }

    expect(ignored).toBeGreaterThan(0);

    const bounded = await ChannelIntake.findOne({ where: { reason: 'loop_bound_reached' } });
    expect(bounded?.status).toBe(INTAKE_STATUSES.IGNORED);

    // A different sender is untouched: the bound is per sender, not global, so
    // one runaway responder cannot deafen the system to everyone else.
    const other = await deliverEmail({
      messageId: '<other@example.com>',
      from: 'quiet@example.com',
      body: 'A normal message',
    });

    expect(other.status).toBe('converted');
  });
});
