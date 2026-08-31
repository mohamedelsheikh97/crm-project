import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { failNextSend, outbox } from '../../src/channels/simulator-store.js';
import { markUnreachable } from '../../src/channels/sms/simulator.js';
import { Message } from '../../src/models/index.js';
import * as messageService from '../../src/services/message.service.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { resetSimulator, seedConversation } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetSimulator();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * US3 — delivery state is reported honestly (FR-047, FR-048, FR-049).
 *
 * An agent who believes an answer arrived stops chasing it. That is the whole
 * reason `sent` and `delivered` are different states.
 */
describe('delivery state', () => {
  it('is never DELIVERED at creation (FR-047)', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    expect(response.status).toBe(201);
    // The simulator hands it over synchronously, so `sent` is honest. Only the
    // provider can say `delivered`, and it has not said so.
    expect(response.body.deliveryState).toBe('sent');
    expect(response.body.deliveryState).not.toBe('delivered');
  });

  it('surfaces a failure with its detail, and does not claim it was sent', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    failNextSend('email', 'mailbox_full', false);

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    // The request succeeded — we recorded the attempt. The MESSAGE failed, and
    // says so where the agent who sent it will see it (FR-048).
    expect(response.status).toBe(201);
    expect(response.body.deliveryState).toBe('failed');
    expect(response.body.deliveryDetail).toBe('mailbox_full');
  });

  it('does NOT retry a permanent refusal (FR-049)', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    // retryable: false — the adapter's judgement, which only it can make.
    failNextSend('email', 'invalid_address', false);

    await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    // One armed failure was consumed and nothing was sent afterwards: a retry
    // would have succeeded on the second attempt and hidden the refusal.
    expect(outbox('email')).toHaveLength(0);
  });

  it('DOES retry a transient failure, within bounds (FR-049)', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    // retryable: true, armed once — the retry should then succeed.
    failNextSend('email', 'connection_reset', true);

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    expect(response.body.deliveryState).toBe('sent');
    expect(outbox('email')).toHaveLength(1);
  });

  it('keeps the row even when the send fails, so the attempt is not lost', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    failNextSend('email', 'mailbox_full', false);

    await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    const stored = await Message.findOne({ where: { direction: 'outbound' } });

    // The row exists BEFORE the send, so a process that dies mid-flight leaves
    // an unconfirmed message rather than no record that anyone tried.
    expect(stored).not.toBeNull();
    expect(stored?.delivery_state).toBe('failed');
  });

  it('makes an unreachable SMS number a visible failure, not silence (FR-067)', async () => {
    const { agent } = await agentAs('agent');
    const { ticket, identity } = await seedConversation({
      channel: 'sms',
      identity: '+201009998888',
    });

    markUnreachable(identity);

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    expect(response.body.deliveryState).toBe('failed');
    expect(response.body.deliveryDetail).toBe('number_not_reachable');
  });
});

describe('later delivery receipts (FR-059, FR-066)', () => {
  it('advances the state when a receipt arrives', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });
    const stored = await Message.findByPk(response.body.id);

    await messageService.applyDeliveryUpdate(
      'email',
      stored?.provider_message_id ?? '',
      'delivered',
    );

    await stored?.reload();
    expect(stored?.delivery_state).toBe('delivered');
  });

  it('NEVER downgrades a state when receipts arrive out of order', async () => {
    // Providers deliver receipts out of order routinely. A `delivered` landing
    // after a `read` must not un-read the message.
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation();

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });
    const stored = await Message.findByPk(response.body.id);
    const providerId = stored?.provider_message_id ?? '';

    await messageService.applyDeliveryUpdate('email', providerId, 'read');
    await messageService.applyDeliveryUpdate('email', providerId, 'delivered');

    await stored?.reload();
    expect(stored?.delivery_state).toBe('read');
  });

  it('ignores a receipt for a message it does not have', async () => {
    await expect(
      messageService.applyDeliveryUpdate('email', 'never-seen', 'delivered'),
    ).resolves.toBeUndefined();
  });
});
