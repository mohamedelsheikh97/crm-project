import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../config/env.js';
import { CHANNELS } from '../../models/message.model.js';
import type {
  ChannelAdapter,
  InboundAttachment,
  InboundMessage,
  OutboundMessage,
  ReplyWindow,
  SendResult,
} from '../types.js';

/**
 * WhatsApp Business (Cloud API).
 *
 * THE 24-HOUR WINDOW IS MODELLED HERE AND NOWHERE ELSE (FR-057, FR-058). The
 * provider refuses a free-form message outside a window that opens when the
 * customer last wrote. `replyWindow` is what lets the composer tell an agent
 * what they may send BEFORE they write it, rather than accepting a message and
 * refusing it afterwards — which is the difference between a constraint and a
 * trap.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

/** The provider's free-form window, in milliseconds. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * When each identity last wrote to us. Process memory, refreshed by every
 * inbound message, and only ever used to decide what to OFFER an agent — the
 * provider remains the authority, and a send it refuses still fails honestly.
 * Being wrong here costs a needless template; being absent costs a rejected
 * message the agent already wrote.
 */
const lastInboundAt = new Map<string, number>();

async function graph(path: string, body: unknown): Promise<Response> {
  return fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

interface CloudApiValue {
  messages?: Array<{
    id: string;
    from: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
    image?: { id: string; mime_type?: string };
    document?: { id: string; mime_type?: string; filename?: string };
  }>;
  statuses?: Array<{ id: string; status: string; recipient_id?: string }>;
}

export const whatsappCloudApiAdapter: ChannelAdapter = {
  channel: CHANNELS.WHATSAPP,
  provider: 'cloud-api',

  isConfigured: () =>
    Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_APP_SECRET),

  async send(message: OutboundMessage): Promise<SendResult> {
    try {
      const response = await graph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        messaging_product: 'whatsapp',
        to: message.recipientIdentity,
        type: 'text',
        text: { body: message.body },
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);

        return {
          providerMessageId: null,
          outboundMessageId: null,
          state: 'failed',
          detail,
          // 4xx is the provider refusing on the merits — a closed window, a
          // blocked number, a malformed request. Retrying repeats the refusal.
          retryable: response.status >= 500,
        };
      }

      const body = (await response.json()) as { messages?: Array<{ id: string }> };

      return {
        providerMessageId: body.messages?.[0]?.id ?? null,
        outboundMessageId: null,
        state: 'sent',
        detail: null,
        retryable: false,
      };
    } catch (error) {
      // A network failure is not a refusal: the message may not have been seen
      // at all, so it is worth another attempt.
      return {
        providerMessageId: null,
        outboundMessageId: null,
        state: 'failed',
        detail: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        retryable: true,
      };
    }
  },

  async replyWindow(identity: string): Promise<ReplyWindow> {
    const last = lastInboundAt.get(identity);
    const openUntil = last === undefined ? 0 : last + WINDOW_MS;
    const freeformAllowed = Date.now() < openUntil;

    return Promise.resolve({
      freeformAllowed,
      // Nothing reopens a window except the customer writing again, so there is
      // no honest future time to name. Saying "unknown" beats inventing one.
      reopensAt: null,
      // Outside the window only pre-approved formats are permitted. The list is
      // configuration rather than something to discover at send time.
      allowedTemplates: freeformAllowed
        ? []
        : ((env.WHATSAPP_VERIFY_TOKEN ? ['support_followup'] : []) as string[]),
    });
  },

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): boolean {
    const presented = headers['x-hub-signature-256'];
    const secret = env.WHATSAPP_APP_SECRET;

    if (!presented || !secret) return false;

    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);

    // Length check first: timingSafeEqual throws on a mismatch.
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(rawBody: Buffer): InboundMessage[] {
    const payload = JSON.parse(rawBody.toString('utf8')) as {
      entry?: Array<{ changes?: Array<{ value?: CloudApiValue }> }>;
    };

    const inbound: InboundMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        // A status-only delivery carries no messages. Returning none is correct
        // and is why parseWebhook returns an array rather than one message.
        for (const message of change.value?.messages ?? []) {
          lastInboundAt.set(message.from, Date.now());

          const attachments: InboundAttachment[] = [];

          inbound.push({
            channel: CHANNELS.WHATSAPP,
            providerMessageId: message.id,
            senderIdentity: message.from,
            recipientIdentity: env.WHATSAPP_PHONE_NUMBER_ID ?? null,
            subject: null,
            body: message.text?.body ?? '',
            bodyFormat: 'text',
            // Media arrives as an id that must be fetched separately; the
            // fetch happens in the poller-side hydration rather than inside
            // parse, which must stay synchronous and side-effect free.
            attachments,
            occurredAt: message.timestamp
              ? new Date(Number(message.timestamp) * 1000)
              : new Date(),
            threadHints: {
              inReplyTo: null,
              references: [],
              addressToken: null,
              providerConversationId: message.from,
            },
            isAutomated: false,
            isOptOut: false,
          });
        }
      }
    }

    return inbound;
  },
};

/** Delivery and read receipts, applied to an already-stored message (FR-059). */
export function parseStatusUpdates(rawBody: Buffer): Array<{ id: string; status: string }> {
  const payload = JSON.parse(rawBody.toString('utf8')) as {
    entry?: Array<{ changes?: Array<{ value?: CloudApiValue }> }>;
  };

  const updates: Array<{ id: string; status: string }> = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        updates.push({ id: status.id, status: status.status });
      }
    }
  }

  return updates;
}
