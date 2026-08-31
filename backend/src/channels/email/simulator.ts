import { CHANNELS } from '../../models/message.model.js';
import { recordSend } from '../simulator-store.js';
import type {
  ChannelAdapter,
  InboundHandler,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from '../types.js';

/**
 * Email with no mail server (research.md D2).
 *
 * Exercises the full inbound and outbound path — threading hints, automated
 * detection, attachments, opt-out — so every email requirement in this phase is
 * testable and demonstrable without a mailbox, and without the commercial
 * dependency Clarifications Q1 removed.
 *
 * `deliver()` is what a test calls. There is no poller: a simulator that ticked
 * on a timer would make tests wait for wall-clock time, which is the discipline
 * Phase 4 established for the scheduler and kept it fast.
 */

let handler: InboundHandler | null = null;

export interface SimulatedEmail {
  messageId?: string;
  from: string;
  to?: string;
  subject?: string;
  body?: string;
  bodyFormat?: 'text' | 'html_source';
  inReplyTo?: string | null;
  references?: string[];
  addressToken?: string | null;
  attachments?: Array<{ fileName: string; content: Buffer; contentType?: string; inline?: boolean }>;
  /** Set by a test to exercise FR-029 without hand-writing headers. */
  automated?: boolean;
  occurredAt?: Date;
}

let sequence = 0;

export function buildInboundEmail(email: SimulatedEmail): InboundMessage {
  sequence += 1;

  return {
    channel: CHANNELS.EMAIL,
    providerMessageId: email.messageId ?? `<sim-in-${Date.now()}-${sequence}@example.com>`,
    senderIdentity: email.from,
    recipientIdentity: email.to ?? null,
    subject: email.subject ?? null,
    body: email.body ?? '',
    bodyFormat: email.bodyFormat ?? 'text',
    attachments: (email.attachments ?? []).map((attachment) => ({
      fileName: attachment.fileName,
      content: attachment.content,
      declaredContentType: attachment.contentType ?? null,
      isInline: attachment.inline === true,
    })),
    occurredAt: email.occurredAt ?? new Date(),
    threadHints: {
      inReplyTo: email.inReplyTo ?? null,
      references: email.references ?? [],
      addressToken: email.addressToken ?? null,
      providerConversationId: null,
    },
    isAutomated: email.automated === true,
    // Email has no standard opt-out signal; unsubscribing from support
    // correspondence is not a thing this phase models.
    isOptOut: false,
  };
}

/** Hand a message to intake, exactly as the real poller would. */
export async function deliver(email: SimulatedEmail): Promise<void> {
  if (!handler) {
    throw new Error('Email simulator has no inbound handler; call start() first.');
  }

  const message = buildInboundEmail(email);
  await handler(message, JSON.stringify(email, jsonSafe));
}

function jsonSafe(_key: string, value: unknown): unknown {
  return Buffer.isBuffer(value) ? `<${value.byteLength} bytes>` : value;
}

export const emailSimulatorAdapter: ChannelAdapter = {
  channel: CHANNELS.EMAIL,
  provider: 'simulator',

  // Always configured: that is the point of it.
  isConfigured: () => true,

  async send(message: OutboundMessage): Promise<SendResult> {
    return Promise.resolve(recordSend(message, true));
  },

  async start(onInbound: InboundHandler): Promise<void> {
    handler = onInbound;
    return Promise.resolve();
  },

  async stop(): Promise<void> {
    handler = null;
    return Promise.resolve();
  },
};
