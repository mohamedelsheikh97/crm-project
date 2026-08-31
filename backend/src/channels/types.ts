import type { Channel } from '../models/message.model.js';

/**
 * THE ADAPTER BOUNDARY (research.md D1, FR-004, FR-112).
 *
 * Everything a provider knows lives behind this file. Everything above it —
 * intake, identity resolution, threading, the timeline, the reply surface — is
 * written against the shapes declared here and never against a vendor payload.
 * That is what makes Clarifications Q1's promise true: swapping the simulator
 * for a real provider is a configuration change, not a rewrite.
 *
 * This file sits beside `tickets/lifecycle.ts` and `auth/permissions.ts` rather
 * than inside `services/`, on the same reasoning: it is a declaration several
 * layers read, holding no business decisions of its own.
 */

export interface InboundAttachment {
  fileName: string;
  /** Raw bytes. The service sniffs the type; a sender's claim is not a fact. */
  content: Buffer;
  /** The sender's claimed type, kept only for diagnostics. Never trusted. */
  declaredContentType: string | null;
  /**
   * TRUE for an image an HTML body references by Content-ID — a signature logo,
   * a tracking pixel, an avatar from a quoted thread. Not a document the
   * customer chose to send, and not listed as one (FR-036).
   */
  isInline: boolean;
}

/**
 * What the adapter offers the threading resolver. Consulted in the fixed order
 * declared in contracts/channel-adapters.md; the SUBJECT IS NOT HERE, and is
 * never consulted (FR-023) — subject lines are edited, translated, and prefixed
 * differently by every client, and two customers writing "Invoice question"
 * would collide.
 */
export interface ThreadHints {
  /** Email In-Reply-To. */
  inReplyTo: string | null;
  /** Email References, oldest first. */
  references: string[];
  /** Signed token from a `support+<token>@` delivery address. */
  addressToken: string | null;
  /** WhatsApp / SMS / chat continuity, where the provider offers one. */
  providerConversationId: string | null;
}

export interface InboundMessage {
  channel: Channel;
  /** The idempotency key (FR-007). Unique per channel in `channel_intake`. */
  providerMessageId: string;
  senderIdentity: string;
  recipientIdentity: string | null;
  /** Email only, and used ONLY as the created ticket's subject — never to thread. */
  subject: string | null;
  body: string;
  bodyFormat: 'text' | 'html_source';
  attachments: InboundAttachment[];
  /** When it happened per the channel, not when we noticed (FR-092). */
  occurredAt: Date;
  threadHints: ThreadHints;
  /**
   * Decided BY THE ADAPTER, not above it (research.md D12). Only the adapter
   * can see the headers or provider flags that reveal an auto-responder, and
   * forcing the judgement upward would mean leaking raw headers through the
   * boundary — exactly what the boundary exists to prevent.
   */
  isAutomated: boolean;
  /** The channel's own opt-out signal, e.g. an SMS STOP keyword (FR-065). */
  isOptOut: boolean;
}

export interface OutboundMessage {
  channel: Channel;
  recipientIdentity: string;
  body: string;
  /** Subject for a channel that has one; ignored where it does not. */
  subject: string | null;
  /** The conversation this continues, for channels that thread on it. */
  providerConversationId: string | null;
  /** Set so the customer's reply threads back to the same ticket (FR-040). */
  replyToToken: string | null;
}

export interface SendResult {
  providerMessageId: string | null;
  /** The Message-ID we generated. Email only; stored and threaded against. */
  outboundMessageId: string | null;
  state: 'sent' | 'failed';
  /** Shown to the agent who sent it (FR-048). Never a stack trace. */
  detail: string | null;
  /**
   * The adapter's judgement, and only it can make it: FR-049 forbids retrying a
   * permanent refusal, and the service layer cannot tell a full mailbox from a
   * malformed address by reading a message string.
   */
  retryable: boolean;
}

/**
 * What a channel permits right now (FR-057, FR-058). WhatsApp implements this;
 * nothing else needs to.
 */
export interface ReplyWindow {
  freeformAllowed: boolean;
  /** When free-form becomes possible again, if the provider says. */
  reopensAt: Date | null;
  /** Pre-approved formats usable while free-form is closed. */
  allowedTemplates: string[];
}

export type InboundHandler = (message: InboundMessage, rawPayload: string) => Promise<void>;

/**
 * OPTIONAL MEMBERS ARE THE HONEST SHAPE. Not every channel polls, has a
 * webhook, or has a reply window. An interface demanding all of them would
 * force four empty implementations per adapter and teach nothing about what
 * each channel actually does.
 */
export interface ChannelAdapter {
  readonly channel: Channel;
  readonly provider: string;

  /** False when credentials are absent. Surfaced to administrators, not hidden. */
  isConfigured(): boolean;

  send(message: OutboundMessage): Promise<SendResult>;

  replyWindow?(identity: string): Promise<ReplyWindow>;

  /** Pollers only. Started from server.ts, never app.ts. */
  start?(onInbound: InboundHandler): Promise<void>;
  stop?(): Promise<void>;

  /** Verified against RAW BYTES, before anything parses the payload (D5). */
  verifyWebhook?(rawBody: Buffer, headers: Record<string, string | undefined>): boolean;
  parseWebhook?(rawBody: Buffer): InboundMessage[];
}

/**
 * WHAT AN ADAPTER MAY NEVER DO — stated as prohibitions because each has a
 * tempting shortcut:
 *
 *   - Write to the database. Adapters return values; the services persist. An
 *     adapter that writes has moved a decision behind the boundary.
 *   - Decide which customer a message belongs to. That is identity.service,
 *     once, for every channel (FR-011).
 *   - Decide which ticket a message threads to. That is intake.service, from
 *     `threadHints`.
 *   - Create, assign, or reopen a ticket. Intake never assigns (FR-027) and
 *     never reopens (research D8); an adapter that could would bypass both.
 *   - Render or format for display. Adapters normalise; the interface renders
 *     from locale files (FR-108).
 */
