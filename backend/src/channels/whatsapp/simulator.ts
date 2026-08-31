import { createHmac, timingSafeEqual } from 'node:crypto';

import { CHANNELS } from '../../models/message.model.js';
import { recordSend } from '../simulator-store.js';
import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
  ReplyWindow,
  SendResult,
} from '../types.js';

/**
 * WhatsApp with no Meta account (research.md D2).
 *
 * IT IMPLEMENTS SIGNATURE VERIFICATION FOR REAL, against a fixed development
 * secret. That is deliberate: if the simulator waved verification through, the
 * verification path would be untested until production, which is the one place
 * nobody wants to discover it. A test can therefore prove that a tampered body
 * is rejected (FR-054) without a Meta app.
 */

const SIMULATOR_SECRET = 'simulator-whatsapp-secret';

/** The reply window a test has put this conversation in. Default: open. */
const closedWindows = new Map<string, { reopensAt: Date | null; templates: string[] }>();

export function sign(body: Buffer): string {
  return `sha256=${createHmac('sha256', SIMULATOR_SECRET).update(body).digest('hex')}`;
}

export function closeReplyWindow(identity: string, templates: string[] = ['appointment_reminder']) {
  closedWindows.set(identity, { reopensAt: null, templates });
}

export function openReplyWindow(identity: string): void {
  closedWindows.delete(identity);
}

export function clearWhatsappSimulator(): void {
  closedWindows.clear();
}

export interface SimulatedWhatsapp {
  eventId?: string;
  from: string;
  body?: string;
  conversationId?: string | null;
  media?: Array<{ fileName: string; content: Buffer; contentType?: string }>;
  optOut?: boolean;
  occurredAt?: Date;
}

let sequence = 0;

/** The webhook body a test posts. Shaped like the real one, minus the noise. */
export function buildWebhookPayload(messages: SimulatedWhatsapp[]): Buffer {
  return Buffer.from(JSON.stringify({ channel: 'whatsapp', messages }));
}

export const whatsappSimulatorAdapter: ChannelAdapter = {
  channel: CHANNELS.WHATSAPP,
  provider: 'simulator',

  isConfigured: () => true,

  async send(message: OutboundMessage): Promise<SendResult> {
    return Promise.resolve(recordSend(message, false));
  },

  async replyWindow(identity: string): Promise<ReplyWindow> {
    const closed = closedWindows.get(identity);

    return Promise.resolve(
      closed
        ? { freeformAllowed: false, reopensAt: closed.reopensAt, allowedTemplates: closed.templates }
        : { freeformAllowed: true, reopensAt: null, allowedTemplates: [] },
    );
  },

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): boolean {
    const presented = headers['x-hub-signature-256'];
    if (!presented) return false;

    const expected = sign(rawBody);
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(rawBody: Buffer): InboundMessage[] {
    const payload = JSON.parse(rawBody.toString('utf8')) as { messages?: SimulatedWhatsapp[] };

    return (payload.messages ?? []).map((message) => {
      sequence += 1;

      return {
        channel: CHANNELS.WHATSAPP,
        providerMessageId: message.eventId ?? `wa-sim-${Date.now()}-${sequence}`,
        senderIdentity: message.from,
        recipientIdentity: null,
        subject: null,
        body: message.body ?? '',
        bodyFormat: 'text' as const,
        attachments: (message.media ?? []).map((item) => ({
          fileName: item.fileName,
          content: item.content,
          declaredContentType: item.contentType ?? null,
          // Media a customer sends on WhatsApp is always a deliberate act —
          // there is no signature-logo equivalent.
          isInline: false,
        })),
        occurredAt: message.occurredAt ?? new Date(),
        threadHints: {
          inReplyTo: null,
          references: [],
          addressToken: null,
          providerConversationId: message.conversationId ?? message.from,
        },
        isAutomated: false,
        isOptOut: message.optOut === true,
      };
    });
  },
};
