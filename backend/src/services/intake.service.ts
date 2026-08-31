import { Op, type Transaction } from 'sequelize';

import type { InboundAttachment, InboundMessage } from '../channels/types.js';
import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { now } from '../lib/clock.js';
import { hit } from '../lib/rate-limit.js';
import { normaliseContact } from '../lib/phone.js';
import { ChannelIntake, Message, Ticket, TicketLink } from '../models/index.js';
import { INTAKE_STATUSES } from '../models/channel-intake.model.js';
import { CHANNELS, type Channel } from '../models/message.model.js';
import type { TicketSource } from '../models/ticket.model.js';
import { INITIAL_STATUS } from '../tickets/lifecycle.js';

import * as automationEngine from './automation-engine.service.js';
import * as attachmentService from './message-attachment.service.js';
import * as historyService from './ticket-history.service.js';
import * as identityService from './identity.service.js';
import * as lifecycleService from './ticket-lifecycle.service.js';
import * as optOutService from './opt-out.service.js';
import * as slaTargetService from './sla-target.service.js';

/**
 * INTAKE — where a message from outside becomes a ticket.
 *
 * THE ORDER OF OPERATIONS IS THE DESIGN, and it is FR-095:
 *
 *   1. record the delivery in `channel_intake` (or discover we already have)
 *   2. only then resolve identity, thread, and create or append
 *   3. mark the ledger row with what became of it
 *
 * Recording first is what makes "nothing accepted is lost" true rather than
 * aspirational. Every failure after step 1 leaves a row with the raw payload
 * and a reason, reprocessable once the cause is fixed. A pipeline that parsed
 * first and recorded last would lose exactly the messages it could not handle —
 * the ones that matter most.
 *
 * The unique index on `(channel, provider_message_id)` is what makes step 1
 * idempotent for EVERY channel at once, with no channel implementing its own
 * deduplication (FR-039, FR-055, FR-094).
 */

export type IntakeOutcome =
  | { status: 'converted'; ticketId: number; messageId: number; created: boolean }
  | { status: 'duplicate'; ticketId: number | null }
  | { status: 'ignored'; reason: string }
  | { status: 'failed'; reason: string };

/** Ticket sources, keyed by channel. Only `manual` has no channel. */
function sourceFor(channel: Channel): TicketSource {
  return channel as TicketSource;
}

/**
 * A subject for a ticket raised from a channel that has none.
 *
 * The first line of what the customer wrote, not "WhatsApp message" — an agent
 * scanning a queue needs to tell one conversation from another, and five rows
 * all reading "SMS message" is a queue you cannot triage.
 */
function subjectFrom(message: InboundMessage): string {
  if (message.subject && message.subject.trim() !== '') {
    return message.subject.trim().slice(0, 255);
  }

  const firstLine =
    message.body
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? '';

  return (firstLine === '' ? 'New conversation' : firstLine).slice(0, 255);
}

/**
 * THREADING (research.md D4, FR-021-FR-024).
 *
 * The resolution order is fixed, and the SUBJECT IS NEVER CONSULTED (FR-023).
 * Subject lines are edited by customers, translated by clients, and prefixed
 * differently by every mail program; two customers writing "Invoice question"
 * would collide, and one customer editing their own subject would fork their
 * own conversation.
 */
async function findThreadTicketId(message: InboundMessage): Promise<number | null> {
  const { inReplyTo, references, providerConversationId } = message.threadHints;

  // 1 and 2: the identifiers WE generated on outbound mail, quoted back at us.
  //   `references` newest-last per the standard, so it is searched in reverse.
  const candidates = [inReplyTo, ...[...references].reverse()].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );

  if (candidates.length > 0) {
    const found = await Message.findOne({
      where: { outbound_message_id: { [Op.in]: candidates } },
      attributes: ['ticket_id'],
    });

    if (found) return found.ticket_id;
  }

  // 3: the signed token in a `support+<token>@` address, for clients that strip
  //    References. Verified, so a guessed token cannot attach a stranger's mail
  //    to someone else's ticket.
  if (message.threadHints.addressToken) {
    const { verifyAddressToken } = await import('../channels/email/imap-smtp.js');
    const ticketId = verifyAddressToken(message.threadHints.addressToken);

    if (ticketId !== null) {
      const exists = await Ticket.findByPk(ticketId, { attributes: ['id'] });
      if (exists) return ticketId;
    }
  }

  // 4: provider-level continuity — a WhatsApp/SMS number, or a chat session.
  //    Matched against the most recent message from that conversation, so a
  //    customer messaging months later starts a new ticket rather than
  //    resurrecting an ancient one.
  if (providerConversationId) {
    const found = await Message.findOne({
      where: {
        channel: message.channel,
        sender_identity_normalised: normaliseContact(
          identityService.contactKindFor(message.channel),
          providerConversationId,
        ),
      },
      order: [['occurred_at', 'DESC']],
      attributes: ['ticket_id'],
    });

    if (found) {
      const ticket = await Ticket.findByPk(found.ticket_id, { attributes: ['id', 'status'] });

      // A closed conversation is finished. The next message starts fresh,
      // and the closed-ticket rule below links the two.
      if (ticket && ticket.status !== 'closed') return found.ticket_id;
      if (ticket) return ticket.id;
    }
  }

  return null;
}

/**
 * THE CLOSED-TICKET RULE (research.md D8, FR-025).
 *
 * A reply to a closed ticket creates a NEW ticket LINKED to the closed one. It
 * does not reopen.
 *
 * This corrects the spec's original assumption, and the reason is in
 * `tickets/lifecycle.ts`: `closed -> open` carries `tickets:reopen`, which
 * Phase 3 Clarifications Q2 deliberately restricted to Supervisors on the
 * stated reasoning that reopening undoes something already finished. An inbound
 * message has no actor and therefore holds no permission. Honouring the
 * assumption would have required intake to bypass a permission the lifecycle
 * declares — a second path through the gate that Phase 3's generated matrix
 * test exists to catch.
 *
 * Linking satisfies FR-025 with machinery Phase 3 already built, leaves the
 * Supervisor-only rule intact, and keeps the customer's reply visible rather
 * than sitting on a closed ticket nobody is working.
 */
async function resolveTargetTicket(
  message: InboundMessage,
  transaction: Transaction,
): Promise<{ ticketId: number | null; linkToClosedId: number | null }> {
  const threadedId = await findThreadTicketId(message);

  if (threadedId === null) return { ticketId: null, linkToClosedId: null };

  const ticket = await Ticket.findByPk(threadedId, { transaction });

  if (!ticket) return { ticketId: null, linkToClosedId: null };

  // A merged ticket is a redirect. The reply belongs on the survivor, resolved
  // through the whole chain by Phase 3's service (FR-024).
  if (ticket.merged_into_ticket_id !== null) {
    const survivorId = await lifecycleService.resolveSurvivorId(ticket);
    const survivor = await Ticket.findByPk(survivorId, { transaction });

    if (survivor && survivor.status !== 'closed') {
      return { ticketId: survivorId, linkToClosedId: null };
    }

    return { ticketId: null, linkToClosedId: survivorId };
  }

  if (ticket.status === 'closed') {
    return { ticketId: null, linkToClosedId: ticket.id };
  }

  return { ticketId: ticket.id, linkToClosedId: null };
}

async function createTicketFor(
  message: InboundMessage,
  customerId: number,
  transaction: Transaction,
): Promise<Ticket> {
  const ticket = await Ticket.create(
    {
      customer_id: customerId,
      subject: subjectFrom(message),
      description: null,
      category: 'general',
      priority: 'normal',
      status: INITIAL_STATUS,
      // NEVER ASSIGNED HERE. Assignment stays Supervisor-only (FR-027, Phase 3
      // Clarifications Q3) — an arriving message does not get to hand itself
      // to whoever happens to be free.
      //
      // PHASE 6 DID NOT CHANGE THAT, and the distinction matters. Automatic
      // assignment runs AFTER intake, through assignment.service, under a
      // policy a Supervisor configured in advance. The authority is still
      // supervisory; what changed is when it is exercised, not who holds it.
      // Intake itself still assigns nothing.
      assignee_user_id: null,
      // No human creator, and the source says who did (FR-026, research D9).
      created_by_user_id: null,
      source: sourceFor(message.channel),
    },
    { transaction },
  );

  // Phase 6 (FR-010). A ticket that arrived by email acquires its SLA targets
  // exactly as a typed one does — which is most of the point: the tickets
  // nobody is watching are the ones that most need a clock on them.
  await slaTargetService.attachTargets(ticket, transaction, ticket.created_at ?? now());

  return ticket;
}

/**
 * Loop prevention (FR-030).
 *
 * Bounded per sender per window. Headers catch the well-behaved majority of
 * auto-responders (research D12); this catches the rest. Both are needed:
 * headers alone fail against a naive responder, and a counter alone would
 * create a ticket for every out-of-office before the bound engaged.
 */
function withinLoopBound(channel: Channel, senderIdentity: string): boolean {
  return hit(`intake:${channel}:${senderIdentity}`, env.INTAKE_RATE_PER_MINUTE).allowed;
}

export interface AcceptOptions {
  /** Chat and forms set this: the ticket is already known. */
  forceTicketId?: number;
  /** Chat sets this so the visitor's session is the conversation. */
  overrideCustomerId?: number;
}

/**
 * Accept one delivery. The only entry point; every channel uses it.
 *
 * `rawPayload` is stored verbatim so a failure is reprocessable (FR-038).
 */
export async function accept(
  message: InboundMessage,
  rawPayload: string,
  options: AcceptOptions = {},
): Promise<IntakeOutcome> {
  // --- Step 1: the ledger row, BEFORE anything else (FR-095) ---------------
  let ledger: ChannelIntake;

  try {
    ledger = await ChannelIntake.create({
      channel: message.channel,
      provider_message_id: message.providerMessageId,
      received_at: now(),
      status: INTAKE_STATUSES.PENDING,
      raw_payload: rawPayload.slice(0, 8_000_000),
      attempts: 1,
    });
  } catch {
    // The unique index rejected it: we have seen this delivery before. That is
    // the ordinary case for a provider retry, not an error (FR-039, FR-055).
    const existing = await ChannelIntake.findOne({
      where: { channel: message.channel, provider_message_id: message.providerMessageId },
    });

    const ticketId = existing?.message_id
      ? ((await Message.findByPk(existing.message_id, { attributes: ['ticket_id'] }))?.ticket_id ??
        null)
      : null;

    return { status: 'duplicate', ticketId };
  }

  const settle = async (
    status: (typeof INTAKE_STATUSES)[keyof typeof INTAKE_STATUSES],
    reason: string | null,
    messageId: number | null,
  ): Promise<void> => {
    ledger.status = status;
    ledger.reason = reason;
    ledger.message_id = messageId;
    await ledger.save();
  };

  try {
    // --- Step 2: the things that are not tickets --------------------------

    // An opt-out is an instruction to the system, not a question for an agent.
    // Converting "STOP" into a ticket would put a refusal in a queue for
    // someone to answer, which is the opposite of honouring it (FR-065).
    if (message.isOptOut) {
      await optOutService.record(message.channel, message.senderIdentity, 'keyword');
      await settle(INTAKE_STATUSES.IGNORED, 'opt_out_keyword', null);
      return { status: 'ignored', reason: 'opt_out_keyword' };
    }

    // Automated mail creates nothing and is answered by nothing (FR-029).
    // IGNORED, not FAILED: it was recognised and correctly handled.
    if (message.isAutomated) {
      await settle(INTAKE_STATUSES.IGNORED, 'automated_mail', null);
      return { status: 'ignored', reason: 'automated_mail' };
    }

    if (!withinLoopBound(message.channel, message.senderIdentity)) {
      await settle(INTAKE_STATUSES.IGNORED, 'loop_bound_reached', null);
      return { status: 'ignored', reason: 'loop_bound_reached' };
    }

    // --- Step 3: identity, threading, and the ticket ----------------------
    const result = await sequelize.transaction(async (transaction) => {
      let ticketId: number;
      let created = false;

      if (options.forceTicketId) {
        ticketId = options.forceTicketId;
      } else {
        const target = await resolveTargetTicket(message, transaction);

        if (target.ticketId !== null) {
          ticketId = target.ticketId;
        } else {
          const customerId =
            options.overrideCustomerId ??
            (
              await identityService.resolveOrCreate(
                message.channel,
                message.senderIdentity,
                transaction,
              )
            ).customerId;

          const ticket = await createTicketFor(message, customerId, transaction);
          ticketId = ticket.id;
          created = true;

          // The closed-ticket rule: link the new ticket to the closed one so
          // the agent can see where the conversation came from (research D8).
          if (target.linkToClosedId !== null) {
            const [lower, higher] =
              target.linkToClosedId < ticketId
                ? [target.linkToClosedId, ticketId]
                : [ticketId, target.linkToClosedId];

            await TicketLink.create(
              {
                ticket_id: lower,
                linked_ticket_id: higher,
                // No human created this link, and the column allows it for the
                // same reason `tickets.created_by_user_id` now does.
                created_by_user_id: null,
              },
              { transaction },
            );
          }
        }
      }

      const stored = await Message.create(
        {
          ticket_id: ticketId,
          channel: message.channel,
          direction: 'inbound',
          author_user_id: null,
          sender_identity: message.senderIdentity.slice(0, 255),
          sender_identity_normalised: normaliseContact(
            identityService.contactKindFor(message.channel),
            message.senderIdentity,
          ).slice(0, 255),
          body: message.body,
          body_format: message.bodyFormat,
          provider_message_id: message.providerMessageId,
          outbound_message_id: null,
          // Inbound is delivered by definition: it is here.
          delivery_state: 'delivered',
          delivery_detail: null,
          occurred_at: message.occurredAt,
        },
        { transaction },
      );

      await historyService.record(
        {
          ticketId,
          event: historyService.TICKET_EVENTS.MESSAGE_RECEIVED,
          actor: historyService.SYSTEM_ACTOR,
          field: 'channel',
          newValue: message.channel,
        },
        transaction,
      );

      // Phase 6 (FR-056). THE TRIGGER THAT MAKES UNTRUSTED INPUT ABLE TO CHANGE
      // STATE — see automation/catalog.ts. It is bounded by the closed catalog,
      // the depth limit, and the fact that every action goes through a service
      // that already refuses what a stranger should not be able to do.
      automationEngine.emit(
        {
          trigger: 'message.received',
          ticketId,
          actorUserId: null,
          messageId: stored.id,
          channel: message.channel,
        },
        transaction,
      );

      return { ticketId, messageId: stored.id, created };
    });

    // Attachments are stored OUTSIDE the transaction, because they touch the
    // filesystem: a rolled-back transaction cannot un-write a file, and a file
    // with no row is easier to reap than a row with no file.
    await storeAttachments(result.messageId, message.attachments);

    await settle(INTAKE_STATUSES.CONVERTED, null, result.messageId);

    // Phase 6 (FR-043). ONLY FOR A NEWLY CREATED TICKET: a message appended to
    // an existing conversation must not re-route work somebody is already
    // doing, and `autoAssign` would refuse anyway because the ticket has an
    // assignee — but saying so here means the intent is readable rather than
    // inferred from a refusal.
    //
    // This is the case automatic assignment most exists for: a ticket that
    // arrived at 02:00 with nobody watching. Never throws — a routing failure
    // must not turn a converted message back into a failed one.
    if (result.created) {
      try {
        const assignmentService = await import('./assignment.service.js');
        await assignmentService.autoAssign(result.ticketId);
      } catch {
        // Recorded by the service; the message is already a ticket, which is
        // what intake promised.
      }
    }

    return {
      status: 'converted',
      ticketId: result.ticketId,
      messageId: result.messageId,
      created: result.created,
    };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 500);

    // FAILED, with the payload retained. Nothing accepted is ever lost
    // (FR-037, SC-010).
    await settle(INTAKE_STATUSES.FAILED, reason, null);

    return { status: 'failed', reason };
  }
}

async function storeAttachments(
  messageId: number,
  attachments: InboundAttachment[],
): Promise<void> {
  for (const attachment of attachments) {
    await attachmentService.store(messageId, attachment);
  }
}

/**
 * Process a failed delivery again, once the cause is fixed (FR-038).
 *
 * `converted` is deliberately NOT reprocessable: doing so would duplicate a
 * ticket, which is the whole thing the ledger exists to prevent.
 */
export async function reprocess(
  intakeId: number,
  parse: (rawPayload: string) => InboundMessage,
): Promise<IntakeOutcome> {
  const ledger = await ChannelIntake.findByPk(intakeId);

  if (!ledger) return { status: 'failed', reason: 'intake_not_found' };

  if (ledger.status === INTAKE_STATUSES.CONVERTED) {
    return { status: 'duplicate', ticketId: null };
  }

  const message = parse(ledger.raw_payload);

  // Clearing the row lets `accept` take its ordinary path, including its own
  // idempotency check, rather than growing a second code path for retries.
  await ledger.destroy();

  const outcome = await accept(message, ledger.raw_payload);

  if (outcome.status === 'converted' || outcome.status === 'ignored') {
    await ChannelIntake.update(
      { attempts: ledger.attempts + 1 },
      { where: { channel: ledger.channel, provider_message_id: ledger.provider_message_id } },
    );
  }

  return outcome;
}

export { CHANNELS };
