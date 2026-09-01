import { Op } from 'sequelize';

import { adapterFor } from '../channels/registry.js';
import { sequelize } from '../config/database.js';
import {
  channelUnavailable,
  channelWindowClosed,
  noReplyChannel,
  notFound,
  recipientOptedOut,
  staleRecord,
  validationError,
} from '../errors/app-error.js';
import { now } from '../lib/clock.js';
import { normaliseContact } from '../lib/phone.js';
import { Customer, Message, Ticket } from '../models/index.js';
import {
  CHANNELS,
  DELIVERY_STATES,
  REPLYABLE_CHANNELS,
  type Channel,
  type DeliveryState,
} from '../models/message.model.js';

import * as auditService from './audit.service.js';
import * as attachmentService from './message-attachment.service.js';
import * as historyService from './ticket-history.service.js';
import * as identityService from './identity.service.js';
import * as lifecycleService from './ticket-lifecycle.service.js';
import * as optOutService from './opt-out.service.js';
import * as slaTargetService from './sla-target.service.js';

/**
 * Reading and writing customer correspondence.
 *
 * THIS SERVICE NEVER TOUCHES `ticket_notes`, AND THE NOTE SERVICE NEVER TOUCHES
 * `messages`. That separation is SC-006 and is structural rather than
 * conventional: the two composers on the ticket screen call different services
 * against different tables, so "send an internal note to the customer by
 * accident" is not a bug that can be written.
 */

export interface Actor {
  id: number;
  email: string;
  fullName: string;
  roleId: number;
}

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface MessageView {
  id: number;
  channel: Channel;
  direction: 'inbound' | 'outbound';
  author: { id: number; fullName: string } | null;
  senderIdentity: string | null;
  body: string;
  bodyFormat: string;
  attachments: attachmentService.AttachmentView[];
  deliveryState: DeliveryState;
  deliveryDetail: string | null;
  occurredAt: Date;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_BODY_LENGTH = 20_000;

function clamp(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.floor(parsed), max) : fallback;
}

type Loaded = Message & { author?: { id: number; full_name: string } | null };

function toView(
  message: Loaded,
  attachments: Map<number, attachmentService.AttachmentView[]>,
): MessageView {
  return {
    id: message.id,
    channel: message.channel,
    direction: message.direction,
    author: message.author ? { id: message.author.id, fullName: message.author.full_name } : null,
    senderIdentity: message.sender_identity,
    body: message.body,
    bodyFormat: message.body_format,
    attachments: attachments.get(message.id) ?? [],
    deliveryState: message.delivery_state,
    deliveryDetail: message.delivery_detail,
    occurredAt: message.occurred_at,
  };
}

export interface MessagePage {
  items: MessageView[];
  page: number;
  pageSize: number;
  total: number;
}

/** The thread on one ticket, oldest first — a conversation reads forwards. */
export async function listForTicket(
  ticketId: number,
  options: { page?: unknown; pageSize?: unknown } = {},
): Promise<MessagePage> {
  const pageSize = clamp(options.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = clamp(options.page, 1, Number.MAX_SAFE_INTEGER);

  const { rows, count } = await Message.findAndCountAll({
    where: { ticket_id: ticketId },
    include: [{ association: 'author', required: false }],
    order: [
      ['occurred_at', 'ASC'],
      // Two messages in the same second need a defined order, and MySQL
      // DATETIME is second-precision.
      ['id', 'ASC'],
    ],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  const attachments = await attachmentService.listFor(rows.map((row) => row.id));

  return {
    items: rows.map((row) => toView(row as Loaded, attachments)),
    page,
    pageSize,
    total: count,
  };
}

export interface Conversation {
  channel: Channel;
  recipientIdentity: string;
  providerConversationId: string | null;
}

/**
 * What a reply on this ticket would go to.
 *
 * DERIVED FROM THE CONVERSATION, NEVER FROM THE REQUEST. The channel and the
 * recipient are read from the most recent inbound message, so a caller cannot
 * redirect a reply to a channel the customer never used, or to an address of
 * their choosing. That is the difference between answering a customer and being
 * a mail relay for anyone holding `messages:send`.
 */
export async function conversationFor(ticketId: number): Promise<Conversation | null> {
  const last = await Message.findOne({
    where: {
      ticket_id: ticketId,
      direction: 'inbound',
      channel: { [Op.in]: REPLYABLE_CHANNELS as string[] },
    },
    order: [
      ['occurred_at', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  if (!last || !last.sender_identity) return null;

  return {
    channel: last.channel,
    recipientIdentity: last.sender_identity,
    providerConversationId:
      last.channel === 'chat' ? null : (last.sender_identity_normalised ?? last.sender_identity),
  };
}

export interface ComposerContext {
  conversation: Conversation | null;
  optOut: optOutService.OptOutView | null;
  window: { freeformAllowed: boolean; reopensAt: Date | null; allowedTemplates: string[] } | null;
}

/**
 * What the composer needs BEFORE the agent types (FR-051, FR-057).
 *
 * Telling someone what they may send is a different product from refusing what
 * they wrote. This is the endpoint that makes the first one possible.
 */
export async function composerContext(ticketId: number): Promise<ComposerContext> {
  const conversation = await conversationFor(ticketId);

  if (!conversation) return { conversation: null, optOut: null, window: null };

  const adapter = adapterFor(conversation.channel);

  const [optOut, window] = await Promise.all([
    optOutService.find(conversation.channel, conversation.recipientIdentity),
    adapter.replyWindow
      ? adapter.replyWindow(conversation.recipientIdentity)
      : Promise.resolve(null),
  ]);

  return { conversation, optOut, window };
}

/**
 * How many times a transient failure is retried before it stands (FR-049).
 *
 * Small and synchronous: a customer reply is a foreground action an agent is
 * watching, and a long retry loop would hold the request open. A permanent
 * refusal is never retried — the adapter says which is which, because only it
 * can tell a full mailbox from a malformed address.
 */
const MAX_SEND_ATTEMPTS = 3;

export async function send(
  ticketId: number,
  input: { body?: unknown },
  actor: Actor,
  context: AuditContext = {},
): Promise<MessageView> {
  const ticket = await Ticket.findByPk(ticketId);

  if (!ticket) throw notFound();

  // A merged ticket is a redirect; a reply belongs on the survivor. Phase 3's
  // guard says so with the survivor's reference, so the agent is told where to
  // go rather than simply refused.
  await lifecycleService.assertWorkable(ticket);

  const body = typeof input.body === 'string' ? input.body.trim() : '';

  if (body === '') {
    throw validationError([{ field: 'body', message: 'messages.error.bodyRequired' }]);
  }

  if (body.length > MAX_BODY_LENGTH) {
    throw validationError([{ field: 'body', message: 'messages.error.bodyTooLong' }]);
  }

  const conversation = await conversationFor(ticketId);

  if (!conversation) throw noReplyChannel();

  const adapter = adapterFor(conversation.channel);

  if (!adapter.isConfigured()) throw channelUnavailable();

  // Checked BEFORE the adapter is called, so a refused message never reaches a
  // provider (FR-051).
  //
  // THE PORTAL IS EXEMPT (Phase 8, FR-037, research D6). Opt-out governs
  // unsolicited contact on a channel that pushes to somebody: a customer who
  // asked us to stop texting them has said something meaningful. The portal
  // pushes nothing — the customer signed in and is reading their own request —
  // and FR-037 forbids an opt-out reducing the completeness of what they can
  // read there. Honouring an opt-out here would silently withhold the answer
  // from the person who came looking for it.
  //
  // ONE EXCLUSION, IN ONE PLACE. A second exemption added elsewhere would be
  // invisible; if another channel ever needs one, it belongs on this line.
  if (
    conversation.channel !== CHANNELS.PORTAL &&
    (await optOutService.isOptedOut(conversation.channel, conversation.recipientIdentity))
  ) {
    throw recipientOptedOut();
  }

  if (adapter.replyWindow) {
    const window = await adapter.replyWindow(conversation.recipientIdentity);

    if (!window.freeformAllowed) {
      throw channelWindowClosed({
        channel: conversation.channel,
        reopensAt: window.reopensAt ? window.reopensAt.toISOString() : null,
        allowedTemplates: window.allowedTemplates,
      });
    }
  }

  // The row exists BEFORE the send, in `pending`. If the process dies
  // mid-flight, the agent sees a message that never confirmed rather than no
  // record that they ever tried — the same persist-then-act rule intake uses.
  const stored = await sequelize.transaction(async (transaction) => {
    const message = await Message.create(
      {
        ticket_id: ticketId,
        channel: conversation.channel,
        direction: 'outbound',
        author_user_id: actor.id,
        sender_identity: conversation.recipientIdentity,
        sender_identity_normalised: normaliseContact(
          identityService.contactKindFor(conversation.channel),
          conversation.recipientIdentity,
        ),
        body,
        body_format: 'text',
        delivery_state: DELIVERY_STATES.PENDING,
        occurred_at: now(),
      },
      { transaction },
    );

    await historyService.record(
      {
        ticketId,
        event: historyService.TICKET_EVENTS.MESSAGE_SENT,
        actor: { id: actor.id, fullName: actor.fullName },
        field: 'channel',
        newValue: conversation.channel,
      },
      transaction,
    );

    // FR-050: correspondence leaving the organisation is a security-relevant
    // event. The BODY IS NOT RECORDED — the audit log says that a message was
    // sent, not what it said; the message row is the content of record.
    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.MESSAGE_SENT,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticketId,
        targetLabel: ticket.subject,
        metadata: {
          messageId: message.id,
          channel: conversation.channel,
          recipient: conversation.recipientIdentity,
        },
        ...context,
      },
      transaction,
    );

    // Phase 6 (FR-015). THE FIRST OUTBOUND CUSTOMER-VISIBLE MESSAGE SATISFIES
    // THE RESPONSE TARGET — and only this path can reach it, which is the
    // point. An internal note is written by ticket-note.service and never comes
    // here, so "a note does not count as a reply" is structural rather than a
    // condition somebody has to remember.
    //
    // Called on EVERY send; the service itself is write-once, so later
    // correspondence cannot re-arm a promise that was already kept (FR-016).
    //
    // Satisfied at the moment we PERSIST the reply, not when the provider
    // confirms it: the organisation answered when the agent pressed send, and a
    // gateway retry is not the customer waiting longer.
    await slaTargetService.satisfyResponse(ticketId, now(), transaction);

    return message;
  });

  let result = await adapter.send({
    channel: conversation.channel,
    recipientIdentity: conversation.recipientIdentity,
    body,
    subject: `Re: ${ticket.subject}`,
    providerConversationId: conversation.providerConversationId,
    replyToToken: await replyTokenFor(conversation.channel, ticketId),
  });

  for (let attempt = 2; attempt <= MAX_SEND_ATTEMPTS && result.state === 'failed'; attempt += 1) {
    if (!result.retryable) break;

    result = await adapter.send({
      channel: conversation.channel,
      recipientIdentity: conversation.recipientIdentity,
      body,
      subject: `Re: ${ticket.subject}`,
      providerConversationId: conversation.providerConversationId,
      replyToToken: await replyTokenFor(conversation.channel, ticketId),
    });
  }

  stored.delivery_state = result.state === 'sent' ? DELIVERY_STATES.SENT : DELIVERY_STATES.FAILED;
  stored.delivery_detail = result.detail;
  stored.provider_message_id = result.providerMessageId;
  stored.outbound_message_id = result.outboundMessageId;
  await stored.save();

  const attachments = await attachmentService.listFor([stored.id]);

  // The author is attached from the ACTOR rather than reloaded. `Message.create`
  // returns a row with no association hydrated, and returning it as-is showed
  // an outbound reply with no sender — which FR-046 forbids and which reads, on
  // screen, as though nobody sent it. A reload would be a second query for a
  // fact this function was handed.
  return toView(
    Object.assign(stored, { author: { id: actor.id, full_name: actor.fullName } }) as Loaded,
    attachments,
  );
}

/** Only email threads on an address token (research D4); nothing else needs one. */
async function replyTokenFor(channel: Channel, ticketId: number): Promise<string | null> {
  if (channel !== 'email') return null;

  const { signAddressToken } = await import('../channels/email/imap-smtp.js');
  return signAddressToken(ticketId);
}

/**
 * Delivery and read receipts arriving later (FR-059, FR-066).
 *
 * Never DOWNGRADES a state. Providers deliver receipts out of order, and a
 * `delivered` that arrives after a `read` must not un-read the message.
 */
const STATE_RANK: Record<string, number> = {
  pending: 0,
  failed: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export async function applyDeliveryUpdate(
  channel: Channel,
  providerMessageId: string,
  state: DeliveryState,
  detail: string | null = null,
): Promise<void> {
  const message = await Message.findOne({
    where: { channel, provider_message_id: providerMessageId, direction: 'outbound' },
  });

  if (!message) return;

  if ((STATE_RANK[state] ?? 0) <= (STATE_RANK[message.delivery_state] ?? 0)) return;

  message.delivery_state = state;
  if (detail !== null) message.delivery_detail = detail;
  await message.save();
}

/**
 * Move a conversation to the correct customer (FR-017).
 *
 * The ticket carries the customer, so reattributing the ticket reattributes
 * every message on it — which is why `messages` holds no `customer_id` of its
 * own (data-model.md). One write, no second place for the truth to drift.
 */
export async function reattribute(
  ticketId: number,
  input: { customerId?: unknown; version?: unknown },
  actor: Actor,
  context: AuditContext = {},
): Promise<{ ticketId: number; customerId: number }> {
  const ticket = await Ticket.findByPk(ticketId);

  if (!ticket) throw notFound();

  const version = Number(input.version);

  if (!Number.isInteger(version) || version !== ticket.version) throw staleRecord();

  const customerId = Number(input.customerId);

  if (!Number.isInteger(customerId) || customerId < 1) {
    throw validationError([{ field: 'customerId', message: 'ticket.error.customerRequired' }]);
  }

  const customer = await Customer.findByPk(customerId);

  if (!customer) {
    throw validationError([{ field: 'customerId', message: 'ticket.error.customerNotFound' }]);
  }

  const previousId = ticket.customer_id;

  await sequelize.transaction(async (transaction) => {
    ticket.customer_id = customerId;
    ticket.version += 1;
    await ticket.save({ transaction });

    await historyService.record(
      {
        ticketId,
        event: historyService.TICKET_EVENTS.REATTRIBUTED,
        actor: { id: actor.id, fullName: actor.fullName },
        field: 'customer',
        previousValue: String(previousId),
        newValue: String(customerId),
      },
      transaction,
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.TICKET_REATTRIBUTED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticketId,
        targetLabel: ticket.subject,
        metadata: { fromCustomerId: previousId, toCustomerId: customerId },
        ...context,
      },
      transaction,
    );
  });

  return { ticketId, customerId };
}
