import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/channels/simulator-store.js';
import { ChannelOptOut, CustomerContact } from '../../src/models/index.js';
import * as optOutService from '../../src/services/opt-out.service.js';
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
 * US3 — a refusal is honoured (FR-051, FR-060, FR-065).
 *
 * The point of this file is the LAST test: an opt-out is keyed by identity, not
 * by customer, so no amount of customer-record churn can resurrect consent.
 */
describe('opt-out refuses an outbound message (FR-051)', () => {
  it('refuses the send and nothing reaches the provider', async () => {
    const { agent } = await agentAs('agent');
    const { ticket, identity } = await seedConversation({ channel: 'sms' });

    await optOutService.record('sms', identity, 'keyword');

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('RECIPIENT_OPTED_OUT');

    // Checked BEFORE the adapter, so a refused message never reaches a provider.
    expect(outbox('sms')).toHaveLength(0);
  });

  it('is visible to the composer BEFORE the agent writes', async () => {
    // Telling someone what they may send is a different product from refusing
    // what they wrote.
    const { agent } = await agentAs('agent');
    const { ticket, identity } = await seedConversation({ channel: 'sms' });

    await optOutService.record('sms', identity, 'keyword');

    const response = await agent.get(`/api/tickets/${ticket.id}/messages/context`);

    expect(response.status).toBe(200);
    expect(response.body.optOut).toMatchObject({ channel: 'sms', source: 'keyword' });
  });

  it('is per channel: refusing SMS does not refuse email', async () => {
    const { agent } = await agentAs('agent');
    const emailTicket = await seedConversation({ channel: 'email' });

    await optOutService.record('sms', 'hala@example.com', 'keyword');

    const response = await agent
      .post(`/api/tickets/${emailTicket.ticket.id}/messages`)
      .send({ body: 'Hello' });

    expect(response.status).toBe(201);
  });

  it('cannot be defeated by formatting the number differently', async () => {
    const { agent } = await agentAs('agent');
    const { ticket } = await seedConversation({ channel: 'sms', identity: '+20 100 123 4567' });

    // Recorded one way, checked another.
    await optOutService.record('sms', '01001234567', 'keyword');

    const response = await agent.post(`/api/tickets/${ticket.id}/messages`).send({ body: 'Hello' });

    expect(response.status).toBe(409);
  });

  it('is idempotent: a provider redelivering STOP writes one row', async () => {
    await optOutService.record('sms', '+201001234567', 'keyword');
    await optOutService.record('sms', '+201001234567', 'keyword');

    expect(await ChannelOptOut.count()).toBe(1);
  });

  it('SURVIVES the number moving to a different customer', async () => {
    // The reason this table is keyed by (channel, identity) and never by
    // customer. A merge, a split, a contact edit, or a deactivation must not be
    // able to quietly resurrect consent — and nobody would notice until someone
    // who asked to be left alone was messaged again.
    const { agent } = await agentAs('agent');
    const first = await seedConversation({ channel: 'sms', identity: '+201001234567' });

    await optOutService.record('sms', '+201001234567', 'keyword');

    // The number is moved to another customer entirely.
    await CustomerContact.destroy({ where: { customer_id: first.customer.id } });

    const second = await seedConversation({ channel: 'sms', identity: '+201001234567' });

    const response = await agent
      .post(`/api/tickets/${second.ticket.id}/messages`)
      .send({ body: 'Hello' });

    // Still refused. The refusal was never about the record.
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('RECIPIENT_OPTED_OUT');
  });
});
