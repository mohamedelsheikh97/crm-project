import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../config/env.js';
import { CHANNELS } from '../../models/message.model.js';
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';

import { isOptOutKeyword } from './segmentation.js';

/**
 * A generic HTTP SMS gateway.
 *
 * Written against the shape almost every gateway shares — POST a recipient and
 * a body, receive an id; accept an HMAC-signed webhook for inbound messages and
 * delivery receipts. Swapping vendors is expected to be a change in this file
 * and nowhere else, which is the promise the adapter boundary makes.
 */

interface GatewayInbound {
  id: string;
  from: string;
  text?: string;
  received_at?: string;
}

export const smsGatewayAdapter: ChannelAdapter = {
  channel: CHANNELS.SMS,
  provider: 'gateway',

  isConfigured: () => Boolean(env.SMS_API_BASE_URL && env.SMS_API_KEY && env.SMS_SENDER_ID),

  async send(message: OutboundMessage): Promise<SendResult> {
    try {
      const response = await fetch(`${env.SMS_API_BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.SMS_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: env.SMS_SENDER_ID,
          to: message.recipientIdentity,
          text: message.body,
        }),
      });

      if (!response.ok) {
        return {
          providerMessageId: null,
          outboundMessageId: null,
          state: 'failed',
          detail: (await response.text()).slice(0, 500),
          // A 4xx names something wrong with the request itself — an unroutable
          // number, a blocked sender. Retrying just repeats it (FR-049, FR-067).
          retryable: response.status >= 500,
        };
      }

      const body = (await response.json()) as { id?: string };

      return {
        providerMessageId: body.id ?? null,
        outboundMessageId: null,
        state: 'sent',
        detail: null,
        retryable: false,
      };
    } catch (error) {
      // A network failure is not a refusal: the gateway may never have seen the
      // request, so another attempt is worth making.
      return {
        providerMessageId: null,
        outboundMessageId: null,
        state: 'failed',
        detail: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        retryable: true,
      };
    }
  },

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): boolean {
    const presented = headers['x-sms-signature'];
    const secret = env.SMS_WEBHOOK_SECRET;

    if (!presented || !secret) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);

    // Length check first: timingSafeEqual throws on a length mismatch.
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(rawBody: Buffer): InboundMessage[] {
    const payload = JSON.parse(rawBody.toString('utf8')) as { messages?: GatewayInbound[] };

    return (payload.messages ?? []).map((message) => {
      const text = message.text ?? '';

      return {
        channel: CHANNELS.SMS,
        providerMessageId: message.id,
        senderIdentity: message.from,
        recipientIdentity: env.SMS_SENDER_ID ?? null,
        subject: null,
        body: text,
        bodyFormat: 'text' as const,
        attachments: [],
        occurredAt: message.received_at ? new Date(message.received_at) : new Date(),
        threadHints: {
          inReplyTo: null,
          references: [],
          addressToken: null,
          providerConversationId: message.from,
        },
        isAutomated: false,
        // STOP is an instruction to the system, not a question for an agent.
        isOptOut: isOptOutKeyword(text),
      };
    });
  },
};
