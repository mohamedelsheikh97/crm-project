import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../src/app.js';
import {
  buildWebhookPayload as buildSms,
  sign as signSms,
} from '../../src/channels/sms/simulator.js';
import {
  buildWebhookPayload as buildWhatsapp,
  sign as signWhatsapp,
} from '../../src/channels/whatsapp/simulator.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { ChannelIntake, Message, Ticket } from '../../src/models/index.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

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

const agent = supertest(app);

/**
 * US6 — webhook authenticity and idempotency (FR-054, FR-055, FR-064, SC-009).
 *
 * These endpoints are reachable by anyone on the internet. The signature is the
 * only thing standing between a provider's messages and an attacker's.
 */
describe('signature verification (FR-054, FR-064)', () => {
  it('accepts a correctly signed WhatsApp delivery', async () => {
    const body = buildWhatsapp([{ eventId: 'wa-1', from: '+201001234567', body: 'Hello' }]);

    const response = await agent
      .post('/api/public/channels/webhooks/whatsapp')
      .set('x-hub-signature-256', signWhatsapp(body))
      .set('content-type', 'application/json')
      .send(body.toString('utf8'));

    expect(response.status).toBe(200);
  });

  it('REJECTS a body tampered with after signing', async () => {
    // The attack this stops: intercept a legitimate delivery, change the
    // sender, replay it. Signing covers the bytes, so any edit invalidates it.
    const original = buildWhatsapp([{ eventId: 'wa-1', from: '+201001234567', body: 'Hello' }]);
    const signature = signWhatsapp(original);

    const tampered = buildWhatsapp([{ eventId: 'wa-1', from: '+209999999999', body: 'Hello' }]);

    const response = await agent
      .post('/api/public/channels/webhooks/whatsapp')
      .set('x-hub-signature-256', signature)
      .set('content-type', 'application/json')
      .send(tampered.toString('utf8'));

    expect(response.status).toBe(401);
    expect(await Ticket.count()).toBe(0);
  });

  it('rejects a delivery with no signature at all', async () => {
    const body = buildSms([{ eventId: 'sms-1', from: '+201001234567', body: 'Hello' }]);

    const response = await agent
      .post('/api/public/channels/webhooks/sms')
      .set('content-type', 'application/json')
      .send(body.toString('utf8'));

    expect(response.status).toBe(401);
  });

  it('verifies against the RAW bytes, not a re-serialisation (research D5)', async () => {
    // The payload below has whitespace and key ordering that JSON.stringify
    // would not reproduce. Verifying against a re-parsed body would fail here
    // — intermittently, which is worse than failing always, because it looks
    // like a provider problem rather than a bug.
    const raw = Buffer.from(
      '{\n  "channel": "sms",\n  "messages": [ {"from": "+201001234567", "eventId": "sms-raw", "body": "Hi"} ]\n}',
    );

    const response = await agent
      .post('/api/public/channels/webhooks/sms')
      .set('x-sms-signature', signSms(raw))
      .set('content-type', 'application/json')
      .send(raw.toString('utf8'));

    expect(response.status).toBe(200);
  });

  it('does not reveal which channels exist', async () => {
    const body = Buffer.from('{}');

    const response = await agent
      .post('/api/public/channels/webhooks/telegram')
      .set('content-type', 'application/json')
      .send(body.toString('utf8'));

    expect(response.status).toBe(404);
  });
});

describe('webhook idempotency (FR-055, SC-009)', () => {
  it('makes one ticket from the same event delivered three times', async () => {
    const body = buildWhatsapp([{ eventId: 'wa-repeat', from: '+201001234567', body: 'Hello' }]);
    const signature = signWhatsapp(body);

    for (let i = 0; i < 3; i += 1) {
      const response = await agent
        .post('/api/public/channels/webhooks/whatsapp')
        .set('x-hub-signature-256', signature)
        .set('content-type', 'application/json')
        .send(body.toString('utf8'));

      expect(response.status).toBe(200);
    }

    expect(await Ticket.count()).toBe(1);
    expect(await Message.count()).toBe(1);
    expect(await ChannelIntake.count()).toBe(1);
  });

  it('does the same on SMS, without SMS implementing its own deduplication', async () => {
    // Every channel gets idempotency from one unique index (research D13).
    const body = buildSms([{ eventId: 'sms-repeat', from: '+201001234567', body: 'Hello' }]);
    const signature = signSms(body);

    for (let i = 0; i < 3; i += 1) {
      await agent
        .post('/api/public/channels/webhooks/sms')
        .set('x-sms-signature', signature)
        .set('content-type', 'application/json')
        .send(body.toString('utf8'));
    }

    expect(await Ticket.count()).toBe(1);
    expect(await Message.count()).toBe(1);
  });
});

describe('inbound conversion (FR-053, FR-061)', () => {
  it('creates a ticket attributed by phone number, with the right source', async () => {
    const { Customer, CustomerContact } = await import('../../src/models/index.js');
    const { normaliseContact } = await import('../../src/lib/phone.js');

    const customer = await Customer.create({
      display_name: 'Hala',
      company: null,
      address: null,
      is_active: true,
      created_by_user_id: null,
    });

    await CustomerContact.create({
      customer_id: customer.id,
      kind: 'phone',
      // Deliberately a different format from the one the webhook will carry.
      value_raw: '0100 123 4567',
      value_normalised: normaliseContact('phone', '0100 123 4567'),
      is_primary: true,
    });

    const body = buildWhatsapp([{ eventId: 'wa-known', from: '+201001234567', body: 'Hello' }]);

    await agent
      .post('/api/public/channels/webhooks/whatsapp')
      .set('x-hub-signature-256', signWhatsapp(body))
      .set('content-type', 'application/json')
      .send(body.toString('utf8'));

    const ticket = await Ticket.findOne();

    expect(ticket?.customer_id).toBe(customer.id);
    expect(ticket?.source).toBe('whatsapp');
    expect(ticket?.created_by_user_id).toBeNull();
    expect(ticket?.assignee_user_id).toBeNull();
  });

  it('records an SMS STOP as an opt-out and raises no ticket (FR-065)', async () => {
    // "STOP" is an instruction to the system, not a question for an agent.
    // Converting it into a ticket would put a refusal in a queue for somebody
    // to answer, which is the opposite of honouring it.
    const body = buildSms([{ eventId: 'sms-stop', from: '+201001234567', body: 'STOP' }]);

    await agent
      .post('/api/public/channels/webhooks/sms')
      .set('x-sms-signature', signSms(body))
      .set('content-type', 'application/json')
      .send(body.toString('utf8'));

    expect(await Ticket.count()).toBe(0);

    const { ChannelOptOut } = await import('../../src/models/index.js');
    const optOut = await ChannelOptOut.findOne();

    expect(optOut?.channel).toBe('sms');
    expect(optOut?.source).toBe('keyword');

    const ledger = await ChannelIntake.findOne();
    expect(ledger?.status).toBe('ignored');
    expect(ledger?.reason).toBe('opt_out_keyword');
  });

  it('does NOT treat a sentence containing "stop" as an opt-out', async () => {
    // A customer writing "please stop sending me the wrong invoice" is making a
    // complaint, and silencing them would be the worst possible reading.
    const body = buildSms([
      { eventId: 'sms-not-stop', from: '+201001234567', body: 'please stop sending the wrong one' },
    ]);

    await agent
      .post('/api/public/channels/webhooks/sms')
      .set('x-sms-signature', signSms(body))
      .set('content-type', 'application/json')
      .send(body.toString('utf8'));

    expect(await Ticket.count()).toBe(1);

    const { ChannelOptOut } = await import('../../src/models/index.js');
    expect(await ChannelOptOut.count()).toBe(0);
  });
});
