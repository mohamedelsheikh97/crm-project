import { randomUUID } from 'node:crypto';

import { CHANNELS } from '../../models/message.model.js';
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from '../types.js';

/**
 * THE CUSTOMER PORTAL AS A CHANNEL (Phase 8, research.md D6).
 *
 * The mirror image of `channels/form/inbound.ts`. That adapter exists to REFUSE
 * `send`, because a form has no reply path. This one exists to succeed at it
 * without doing anything, because a portal message needs no transport: both ends
 * of the conversation are inside this application, and the message is delivered
 * by being read.
 *
 * WHY THE PORTAL IS A REPLYABLE CHANNEL AT ALL, which is not the obvious answer:
 * `message.service.conversationFor` derives the reply channel and recipient from
 * the most recent inbound message filtered to `REPLYABLE_CHANNELS`, and returns
 * null otherwise. Had the portal been inbound-only like `form`, a
 * portal-submitted ticket would have had NO REPLY PATH AT ALL — the hole Phase 5
 * left for form submissions, inherited into the one phase whose Definition of
 * done requires a customer to be answered where they wrote.
 *
 * NO PROVIDER, NO CREDENTIAL, NO `CHANNEL_PORTAL_PROVIDER`. This system is the
 * provider — the reasoning the registry already records for `chat` — so
 * `isConfigured` is unconditionally true and there is nothing an administrator
 * could point it at instead. That is also why the registry excludes it from
 * `assertProductionReady`: its "simulator" IS the real implementation.
 *
 * `state: 'sent'`, NOT `'delivered'`. Phase 5 built the delivery ladder because
 * "`pending` and `sent` are NOT `delivered` — an agent who believes an answer
 * arrived stops chasing it". At the moment of writing, the honest claim is that
 * the message is available: the customer has not read it. `portal-ticket.service`
 * promotes it to `read` when the owning contact's portal actually returns it,
 * which is the one place in this project where `read` can be asserted truthfully
 * with no provider to ask.
 */

export interface PortalReplyInput {
  /** The submitting contact's own address, used as `sender_identity`. */
  senderIdentity: string;
  body: string;
  occurredAt?: Date;
}

/**
 * Builds the inbound message for a customer's reply.
 *
 * `providerMessageId` is a generated UUID rather than something derived from the
 * body or the clock. It exists only to satisfy the per-channel idempotency key
 * Phase 5's intake ledger requires; a portal reply arrives exactly once, over an
 * authenticated request we control, so there is no provider redelivery to
 * deduplicate against and nothing to derive it from.
 */
export function buildInboundReply(input: PortalReplyInput): InboundMessage {
  return {
    channel: CHANNELS.PORTAL,
    providerMessageId: `portal:${randomUUID()}`,
    senderIdentity: input.senderIdentity,
    recipientIdentity: null,
    // The portal always replies on an existing request, so it never names a
    // subject: the ticket already has one, and letting a reply change it would
    // let a customer rewrite the record of what they asked.
    subject: null,
    body: input.body,
    // TEXT, ALWAYS. The portal accepts no markup and renders none — see
    // contracts/visibility-contract.md. `html_source` exists for inbound email.
    bodyFormat: 'text',
    // FR-022: the portal accepts no inbound files at all in this phase.
    attachments: [],
    occurredAt: input.occurredAt ?? new Date(),
    // The reply is always on a ticket the caller named, so threading never has
    // to be inferred. The service attaches it directly.
    threadHints: {
      inReplyTo: null,
      references: [],
      addressToken: null,
      providerConversationId: null,
    },
    // A signed-in human pressed send. Neither of these can be true here, and
    // both are decided by the adapter by contract (research D12).
    isAutomated: false,
    isOptOut: false,
  };
}

export const portalAdapter: ChannelAdapter = {
  channel: CHANNELS.PORTAL,
  // Named for what it is rather than borrowing `form`'s 'inbound', because this
  // one does send. The administration screen shows this string.
  provider: 'in-app',

  // Nothing to configure. There is no credential this could be missing.
  isConfigured: () => true,

  async send(_message: OutboundMessage): Promise<SendResult> {
    // No network call, and deliberately no failure mode. The message is already
    // stored by the time this returns; the customer reads it from the same
    // database it was written to. There is nothing here that can go wrong
    // independently of the write, which is why this adapter has no retry
    // semantics to speak of.
    return Promise.resolve({
      // No provider, so no provider id. Not an omission — there is nobody to
      // have issued one.
      providerMessageId: null,
      outboundMessageId: null,
      state: 'sent',
      detail: null,
      // Nothing to retry: a failure here would mean the database write failed,
      // and that is the caller's transaction to roll back, not ours to repeat.
      retryable: false,
    });
  },
};

/** Kept so `message.length` is never the reason a reply is silently truncated. */
export const PORTAL_MESSAGE_MAX_LENGTH = 10_000;
