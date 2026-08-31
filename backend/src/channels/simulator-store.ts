import type { Channel } from '../models/message.model.js';
import type { OutboundMessage, SendResult } from './types.js';

/**
 * Where simulated outbound messages go (research.md D2).
 *
 * THE SIMULATOR IS A TRANSPORT, NOT A MODE. It is selected by the same
 * `CHANNEL_*_PROVIDER` variable a real provider is, so the code path under test
 * is the code path that runs in production right up to the adapter boundary.
 * A global `MOCK=true` flag would have tested a different program.
 *
 * This store is what makes an assertion possible: a test sends a reply and then
 * asks what left. Nothing in production reads it.
 *
 * In-process and unbounded-until-cleared, which is correct for its two callers
 * — the test suite, which clears between cases, and a developer poking at the
 * running application.
 */

export interface SentSimulatedMessage {
  channel: Channel;
  recipientIdentity: string;
  subject: string | null;
  body: string;
  providerMessageId: string;
  outboundMessageId: string | null;
  sentAt: Date;
}

const sent: SentSimulatedMessage[] = [];

/** Fails the next send on this channel. Exercises FR-048 and FR-049. */
const failures = new Map<Channel, { detail: string; retryable: boolean }>();

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function recordSend(message: OutboundMessage, generateMessageId: boolean): SendResult {
  const forced = failures.get(message.channel);

  if (forced) {
    failures.delete(message.channel);
    return {
      providerMessageId: null,
      outboundMessageId: null,
      state: 'failed',
      detail: forced.detail,
      retryable: forced.retryable,
    };
  }

  const providerMessageId = nextId(`sim-${message.channel}`);
  // Email is the only channel where WE mint an identifier the customer's reply
  // will quote back at us (research.md D4).
  const outboundMessageId = generateMessageId ? `<${nextId('out')}@crm.local>` : null;

  sent.push({
    channel: message.channel,
    recipientIdentity: message.recipientIdentity,
    subject: message.subject,
    body: message.body,
    providerMessageId,
    outboundMessageId,
    sentAt: new Date(),
  });

  return {
    providerMessageId,
    outboundMessageId,
    state: 'sent',
    detail: null,
    retryable: false,
  };
}

/** Everything the simulator has "delivered", oldest first. */
export function outbox(channel?: Channel): SentSimulatedMessage[] {
  return channel ? sent.filter((message) => message.channel === channel) : [...sent];
}

export function lastSent(channel: Channel): SentSimulatedMessage | undefined {
  return [...sent].reverse().find((message) => message.channel === channel);
}

/** Arms one failure, consumed by the next send on that channel. */
export function failNextSend(channel: Channel, detail: string, retryable: boolean): void {
  failures.set(channel, { detail, retryable });
}

export function clearSimulator(): void {
  sent.length = 0;
  failures.clear();
}
