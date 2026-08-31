import { createHmac, timingSafeEqual } from 'node:crypto';

import { CHANNELS } from '../../models/message.model.js';
import { recordSend } from '../simulator-store.js';
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';

import { isOptOutKeyword, segmentsFor } from './segmentation.js';

/**
 * SMS with no gateway account (research.md D2).
 *
 * Verifies signatures for real against a development secret, for the same
 * reason the WhatsApp simulator does: a verification path that only runs in
 * production is a verification path nobody has tested.
 */

const SIMULATOR_SECRET = 'simulator-sms-secret';

export function sign(body: Buffer): string {
  return createHmac('sha256', SIMULATOR_SECRET).update(body).digest('hex');
}

export interface SimulatedSms {
  eventId?: string;
  from: string;
  body?: string;
  occurredAt?: Date;
}

export function buildWebhookPayload(messages: SimulatedSms[]): Buffer {
  return Buffer.from(JSON.stringify({ channel: 'sms', messages }));
}

/** Numbers a test has marked unreachable, to exercise FR-067. */
const unreachable = new Set<string>();

export function markUnreachable(identity: string): void {
  unreachable.add(identity);
}

export function clearSmsSimulator(): void {
  unreachable.clear();
}

let sequence = 0;

export const smsSimulatorAdapter: ChannelAdapter = {
  channel: CHANNELS.SMS,
  provider: 'simulator',

  isConfigured: () => true,

  async send(message: OutboundMessage): Promise<SendResult> {
    if (unreachable.has(message.recipientIdentity)) {
      // A number that cannot receive SMS is a permanent refusal, and must
      // produce a visible failure rather than silence (FR-067).
      return Promise.resolve({
        providerMessageId: null,
        outboundMessageId: null,
        state: 'failed',
        detail: 'number_not_reachable',
        retryable: false,
      });
    }

    return Promise.resolve(recordSend(message, false));
  },

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): boolean {
    const presented = headers['x-sms-signature'];
    if (!presented) return false;

    const a = Buffer.from(presented);
    const b = Buffer.from(sign(rawBody));

    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(rawBody: Buffer): InboundMessage[] {
    const payload = JSON.parse(rawBody.toString('utf8')) as { messages?: SimulatedSms[] };

    return (payload.messages ?? []).map((message) => {
      sequence += 1;
      const body = message.body ?? '';

      return {
        channel: CHANNELS.SMS,
        providerMessageId: message.eventId ?? `sms-sim-${Date.now()}-${sequence}`,
        senderIdentity: message.from,
        recipientIdentity: null,
        subject: null,
        body,
        bodyFormat: 'text' as const,
        attachments: [],
        occurredAt: message.occurredAt ?? new Date(),
        threadHints: {
          inReplyTo: null,
          references: [],
          addressToken: null,
          providerConversationId: message.from,
        },
        isAutomated: false,
        // STOP is an instruction to the system, not a question for an agent.
        isOptOut: isOptOutKeyword(body),
      };
    });
  },
};

export { segmentsFor };
