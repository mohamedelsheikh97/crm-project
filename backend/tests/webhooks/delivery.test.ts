import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { classify, deliver } from '../../src/integrations/delivery.js';
import { verify } from '../../src/integrations/signing.js';
import * as subscriptionService from '../../src/services/webhook-subscription.service.js';
import { WebhookSubscription } from '../../src/models/index.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { startReceiver, subscriptionFor, type Receiver } from './helpers.js';

/**
 * Delivery, against a REAL receiver (Phase 11, US2, FR-027, FR-035, FR-036,
 * SC-014).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REAL HTTP SERVER, NOT A MOCKED `fetch`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A mock would let this file pass while the signature was computed over a
 * re-serialised body, while `redirect: 'manual'` was missing, or while the
 * timeout was never applied — three real defects this phase can ship, and none
 * of which a mock would notice. The point is to read what actually arrives on
 * the wire.
 */
describe('webhook delivery', () => {
  let receiver: Receiver;

  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await truncateAll();
    receiver = await startReceiver();
  });

  afterEach(async () => {
    await receiver.close();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  const payload = {
    event_id: 'e-1',
    event_type: 'ticket.created',
    occurred_at: '2026-09-03T10:00:00.123Z',
    api_version: '1',
    subject: { type: 'ticket', id: 42, url: '/api/v1/tickets/42' },
  };

  it('delivers the payload and reports success', async () => {
    receiver.respondWith(200);

    const outcome = await deliver({
      url: receiver.url,
      eventType: 'ticket.created',
      eventKey: 'e-1',
      payload,
      secrets: ['secret-one'],
    });

    expect(outcome.kind).toBe('succeeded');
    expect(receiver.requests.length).toBe(1);
  });

  it('signs what it SENDS — the same bytes, verified as a receiver would', async () => {
    receiver.respondWith(200);

    await deliver({
      url: receiver.url,
      eventType: 'ticket.created',
      eventKey: 'e-1',
      payload,
      secrets: ['secret-one'],
    });

    const [request] = receiver.requests;
    const header = request!.headers['x-crm-signature'];

    expect(header).toBeDefined();

    /**
     * VERIFIED OVER THE RAW BODY THAT ARRIVED.
     *
     * This is the assertion that catches the classic bug: serialising twice —
     * once to sign, once to send — because key order and number formatting are
     * not guaranteed to match. If `delivery.ts` re-stringified the payload, the
     * bytes here would differ from the signed ones and this would fail.
     */
    const result = verify({
      header: header!,
      body: request!.body,
      secret: 'secret-one',
    });

    expect(result.valid).toBe(true);
  });

  it('FAILS verification when a single byte of the body is altered (SC-014)', async () => {
    receiver.respondWith(200);

    await deliver({
      url: receiver.url,
      eventType: 'ticket.created',
      eventKey: 'e-1',
      payload,
      secrets: ['secret-one'],
    });

    const [request] = receiver.requests;
    const tampered = request!.body.replace('"id":42', '"id":43');

    expect(tampered).not.toBe(request!.body);

    const result = verify({
      header: request!.headers['x-crm-signature']!,
      body: tampered,
      secret: 'secret-one',
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('mismatch');
  });

  it('fails verification against the WRONG secret', async () => {
    receiver.respondWith(200);

    await deliver({
      url: receiver.url,
      eventType: 'ticket.created',
      eventKey: 'e-1',
      payload,
      secrets: ['secret-one'],
    });

    const [request] = receiver.requests;

    const result = verify({
      header: request!.headers['x-crm-signature']!,
      body: request!.body,
      secret: 'a-different-secret',
    });

    expect(result.valid).toBe(false);
  });

  it('rejects a STALE timestamp even with a correct signature', async () => {
    receiver.respondWith(200);

    await deliver({
      url: receiver.url,
      eventType: 'ticket.created',
      eventKey: 'e-1',
      payload,
      secrets: ['secret-one'],
    });

    const [request] = receiver.requests;

    /**
     * The timestamp is INSIDE the signed material, which is what makes the
     * tolerance enforceable: a replayed request cannot have its timestamp
     * updated without invalidating the signature. Signing the body alone would
     * let a captured payload be replayed forever.
     */
    const result = verify({
      header: request!.headers['x-crm-signature']!,
      body: request!.body,
      secret: 'secret-one',
      now: Math.floor(Date.now() / 1000) + 10_000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('stale');
  });

  it('sends TWO signatures during a rotation overlap (FR-038)', async () => {
    receiver.respondWith(200);

    await deliver({
      url: receiver.url,
      eventType: 'ticket.created',
      eventKey: 'e-1',
      payload,
      // Current first, previous second.
      secrets: ['new-secret', 'old-secret'],
    });

    const [request] = receiver.requests;
    const header = request!.headers['x-crm-signature']!;

    expect(header.match(/v1=/g)?.length).toBe(2);

    /**
     * EITHER verifies. That is what lets a receiver redeploy with the new secret
     * without dropping notifications in between — a sequence of one-secret
     * windows would drop them, which is the outage rotation exists to avoid.
     */
    expect(verify({ header, body: request!.body, secret: 'new-secret' }).valid).toBe(true);
    expect(verify({ header, body: request!.body, secret: 'old-secret' }).valid).toBe(true);
    expect(verify({ header, body: request!.body, secret: 'unrelated' }).valid).toBe(false);
  });

  it('carries the event identifier in a header as well as the body (FR-031)', async () => {
    receiver.respondWith(200);

    await deliver({
      url: receiver.url,
      eventType: 'ticket.resolved',
      eventKey: 'stable-key-1',
      payload,
      secrets: ['secret-one'],
    });

    const [request] = receiver.requests;

    // In the header so a receiver can deduplicate BEFORE parsing the body,
    // which matters for the retry it has already handled.
    expect(request!.headers['x-crm-event-id']).toBe('stable-key-1');
    expect(request!.headers['x-crm-event']).toBe('ticket.resolved');
  });

  it('does NOT follow a redirect (FR-035)', async () => {
    /**
     * A public endpoint answering `302 http://169.254.169.254/` would otherwise
     * walk the address guard straight past itself — the guard checks the URL we
     * were given, not the one a hop takes us to.
     */
    receiver.respondWith(302, { Location: 'http://169.254.169.254/latest/meta-data/' });

    const outcome = await deliver({
      url: receiver.url,
      eventType: 'ticket.created',
      eventKey: 'e-1',
      payload,
      secrets: ['secret-one'],
    });

    expect(outcome.kind).toBe('permanent');
    expect(outcome.status).toBe(302);
    if (outcome.kind === 'permanent') {
      // Named plainly, because an administrator seeing this needs to know it is
      // their receiver's configuration rather than our network.
      expect(outcome.reason).toMatch(/redirect/);
    }

    // Exactly one request: the redirect was not chased.
    expect(receiver.requests.length).toBe(1);
  });

  it('times out rather than holding a socket open', async () => {
    receiver.hang();

    const outcome = await deliver({
      url: receiver.url,
      eventType: 'ticket.created',
      eventKey: 'e-1',
      payload,
      secrets: ['secret-one'],
    });

    /**
     * Transient, because a receiver that is slow now may not be in five
     * minutes. The reason names the budget so an administrator can tell a
     * timeout from a refusal.
     */
    expect(outcome.kind).toBe('transient');
    if (outcome.kind === 'transient') {
      expect(outcome.reason).toMatch(/no response within/);
    }
  }, 30_000);

  it('classifies statuses the way the retry logic needs', () => {
    /**
     * Asserted directly rather than by standing up a receiver per code: the
     * classification IS the decision, and driving it through HTTP would test
     * `fetch` as much as this.
     */
    expect(classify(200).kind).toBe('succeeded');
    expect(classify(204).kind).toBe('succeeded');

    // The two 4xx codes that ARE transient. Treating them as permanent would
    // abandon a receiver that explicitly asked to be retried.
    expect(classify(408).kind).toBe('transient');
    expect(classify(429).kind).toBe('transient');

    // Everything else 4xx is permanent: retrying a 404 for twenty-one hours
    // tells an administrator nothing they did not know after the first attempt.
    expect(classify(400).kind).toBe('permanent');
    expect(classify(401).kind).toBe('permanent');
    expect(classify(404).kind).toBe('permanent');
    expect(classify(410).kind).toBe('permanent');

    expect(classify(500).kind).toBe('transient');
    expect(classify(503).kind).toBe('transient');

    expect(classify(301).kind).toBe('permanent');
  });

  it('refuses a subscription whose signing secret cannot be opened', async () => {
    const { subscriptionId } = await subscriptionFor(receiver.url);

    // Corrupt the sealed value, as a changed `WEBHOOK_SIGNING_KEY` would.
    await WebhookSubscription.update(
      { signing_secret_sealed: 'not.a.sealed-value' },
      { where: { id: subscriptionId } },
    );

    const subscription = await WebhookSubscription.findByPk(subscriptionId);

    /**
     * It THROWS rather than returning no secrets, and the delivery service turns
     * that into an abandoned attempt with a reason.
     *
     * Sending unsigned would be worse than failing: an unsigned notification is
     * one a receiver cannot trust (FR-027), and the administrator's action —
     * rotate the subscription's secret — is one they can only take if they are
     * told.
     */
    expect(() => subscriptionService.signingSecretsFor(subscription!)).toThrow();
  });
});
