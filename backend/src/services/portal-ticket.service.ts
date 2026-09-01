import { Op, type WhereOptions } from 'sequelize';

import { buildInboundReply, PORTAL_MESSAGE_MAX_LENGTH } from '../channels/portal/in-app.js';
import { notFound, ticketSettled, validationError, type ErrorDetail } from '../errors/app-error.js';
import { Message, Ticket, TicketSatisfaction } from '../models/index.js';
import { CHANNELS, DELIVERY_STATES, type Channel } from '../models/message.model.js';
import { customerStateFor, type CustomerState } from '../portal/customer-status.js';
import { parseReference, toReference } from '../tickets/reference.js';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, DEFAULT_PRIORITY } from '../tickets/taxonomy.js';
import { isTicketCategory, isTicketPriority } from '../tickets/taxonomy.js';

import * as attachmentService from './message-attachment.service.js';
import * as intakeService from './intake.service.js';
import type { PortalSessionContext } from './portal-auth.service.js';
import * as ticketService from './ticket.service.js';
import * as lifecycleService from './ticket-lifecycle.service.js';

/**
 * WHAT A PORTAL SESSION MAY REACH (Phase 8, Clarifications Q2, FR-016,
 * research.md D5).
 *
 * ONE FUNCTION, APPLIED INSIDE THE `where` OF EVERY PORTAL QUERY. Not as a
 * filter over loaded rows, not as an ownership check after a `findByPk`.
 * `timeline.service.ts` states the reasoning for its own filter and it is the
 * reasoning here: applied at fetch time "so that when a later phase narrows
 * ticket visibility this service narrows with it instead of quietly disclosing".
 *
 * `requesting_contact_id` alone would be sufficient — a contact belongs to one
 * customer, so the second clause implies the first. `customer_id` IS APPLIED
 * ANYWAY. It costs nothing, and it means a future mistake in the contact clause
 * fails closed at the customer boundary instead of open. The cheap redundant
 * defence is the one you want in the query that decides whether a stranger reads
 * somebody's correspondence.
 *
 * NULL IS NOT A MATCH, and that is the whole of FR-026f. A ticket with no
 * requesting contact is reachable by NOBODY in the portal — Sequelize renders
 * `requesting_contact_id = <id>`, which no NULL row satisfies. Do not "improve"
 * this with an `[Op.or]` that also accepts NULL: that single change would show
 * every contact on a company record every unassociated ticket the organisation
 * holds for it, silently, on the oldest data in the system.
 */
export function portalScope(session: PortalSessionContext): WhereOptions {
  return {
    customer_id: session.customerId,
    requesting_contact_id: session.contactId,
  };
}

// --- The projection --------------------------------------------------------

/**
 * WHAT A CUSTOMER MAY SEE OF A MESSAGE.
 *
 * Deliberately NOT `message.service.MessageView`, which carries
 * `author: { id, fullName }` — a staff member's name and id. FR-031 excludes
 * assignee identity, and an outbound message's author is the same disclosure by
 * another route. The customer needs to know the message came from the support
 * team, not which named person typed it.
 *
 * `deliveryState` is absent too. It is an operational fact about our own
 * sending, and a customer reading "failed" on a message they are looking at is
 * both confusing and untrue.
 */
export interface PortalMessageView {
  direction: 'inbound' | 'outbound';
  channel: Channel;
  occurredAt: Date;
  body: string;
  attachments: attachmentService.AttachmentView[];
}

export interface PortalTicketSummary {
  reference: string;
  subject: string;
  state: CustomerState;
  isSettled: boolean;
  raisedAt: Date;
  lastChangedAt: Date;
}

/**
 * THE FROZEN SHAPE (Phase 8, FR-030, FR-031, research.md D14).
 *
 * Built field by field by `toDetail` below. NEVER a Sequelize instance, never a
 * spread of one, never `toJSON()` with deletions. `tests/portal/projection.test.ts`
 * asserts that the response's key set EQUALS this interface's, on a fixture
 * carrying every excluded thing — so a field added to any internal ticket
 * surface cannot appear here, and a field added HERE is a deliberate edit to a
 * test that says in one place what a customer may see.
 *
 * Phase 5 built the property this rests on and said so in `timeline.service.ts`:
 * the timeline reads `messages` and nothing else, so "the structure Phase 8 will
 * build a customer-facing view on contains nothing internal to leak. A later
 * phase that adds notes or history here destroys that property, and it will not
 * be obvious that it has." The frozen key set is the guard against the
 * "not obvious" part.
 */
export interface PortalTicketView {
  reference: string;
  subject: string;
  description: string | null;
  state: CustomerState;
  isSettled: boolean;
  raisedAt: Date;
  lastChangedAt: Date;
  category: string;
  priority: string;
  ratingOffered: boolean;
  replyOffered: boolean;
  satisfaction: { score: number; comment: string | null; submittedAt: Date } | null;
  messages: PortalMessageView[];
}

function toSummary(ticket: Ticket): PortalTicketSummary {
  const state = customerStateFor(ticket.status);

  return {
    // A REFERENCE, NEVER AN ID (FR-065). Phase 3's rule, and Phase 7's
    // slug-not-id argument applies identically: sequential ids in a
    // customer-facing surface disclose volume and invite enumeration.
    reference: toReference(ticket.id),
    subject: ticket.subject,
    state: state.state,
    isSettled: state.ratingOffered,
    raisedAt: ticket.created_at,
    lastChangedAt: ticket.updated_at,
  };
}

// --- Reading ---------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function clampPage(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.floor(parsed), max) : fallback;
}

export interface PortalTicketPage {
  items: PortalTicketSummary[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * This contact's requests (FR-026, FR-027).
 *
 * MERGED TICKETS ARE EXCLUDED. A merged ticket is a redirect, and listing it
 * would show the customer two entries for one conversation — with the
 * merged-away one frozen at whatever status it had. Its reference still resolves
 * (see `findScoped`), because a customer holding one must not hit a dead end.
 */
export async function list(
  session: PortalSessionContext,
  options: { page?: unknown; pageSize?: unknown } = {},
): Promise<PortalTicketPage> {
  const pageSize = clampPage(options.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = clampPage(options.page, 1, Number.MAX_SAFE_INTEGER);

  const { rows, count } = await Ticket.findAndCountAll({
    where: { ...portalScope(session), merged_into_ticket_id: null },
    order: [
      ['updated_at', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { items: rows.map(toSummary), page, pageSize, total: count };
}

/**
 * Resolves a reference to a ticket this contact may see, or refuses.
 *
 * THE ONLY WAY A PORTAL REQUEST TURNS A REFERENCE INTO A TICKET. Every handler
 * goes through it, so the scope cannot be forgotten on one route.
 *
 * `notFound()` for every refusal (FR-017): another customer's ticket, a
 * colleague's on the same record, one with no contact association, and one that
 * has never existed all produce the identical 404. A distinguishable answer for
 * "not yours" would confirm the record exists, which on a company record
 * confirms a colleague's activity.
 *
 * MERGE FOLLOWS THE SURVIVOR AND RE-APPLIES THE SCOPE (FR-032, FR-026j). A
 * customer holding a reference that was merged away reaches the live
 * conversation — but only if their contact is associated with the SURVIVOR.
 * Following the redirect without re-checking would make a merge a way to hand
 * somebody a conversation they could not otherwise see.
 */
export async function findScoped(
  session: PortalSessionContext,
  reference: unknown,
): Promise<Ticket> {
  const id = typeof reference === 'string' ? parseReference(reference) : null;

  if (id === null) throw notFound();

  const ticket = await Ticket.findOne({ where: { id, ...portalScope(session) } });

  if (!ticket) throw notFound();

  if (ticket.merged_into_ticket_id === null) return ticket;

  const survivorId = await lifecycleService.resolveSurvivorId(ticket);

  if (survivorId === ticket.id) return ticket;

  const survivor = await Ticket.findOne({ where: { id: survivorId, ...portalScope(session) } });

  // The survivor belongs to a different contact. Same 404 as everything else:
  // the customer learns that this reference leads nowhere for them, not that it
  // led somewhere for somebody they work with.
  if (!survivor) throw notFound();

  return survivor;
}

/**
 * One request, in full (FR-029, FR-030, FR-031).
 *
 * The messages are read by the RESOLVED TICKET'S ID, never by an id from the
 * URL — `findScoped` runs first and its result is the only thing that names a
 * ticket here.
 */
export async function show(
  session: PortalSessionContext,
  reference: unknown,
): Promise<PortalTicketView> {
  const ticket = await findScoped(session, reference);

  const messages = await Message.findAll({
    where: { ticket_id: ticket.id },
    order: [
      ['occurred_at', 'ASC'],
      // Two messages in the same second need a defined order, and MySQL
      // DATETIME is second-precision.
      ['id', 'ASC'],
    ],
  });

  const attachments = await attachmentService.listFor(messages.map((message) => message.id));
  const satisfaction = await TicketSatisfaction.findOne({ where: { ticket_id: ticket.id } });
  const state = customerStateFor(ticket.status);

  // Fire-and-forget: the customer has now seen whatever we sent them.
  await markOutboundRead(ticket.id);

  return {
    reference: toReference(ticket.id),
    subject: ticket.subject,
    description: ticket.description,
    state: state.state,
    isSettled: state.ratingOffered,
    raisedAt: ticket.created_at,
    lastChangedAt: ticket.updated_at,
    // Taxonomy KEYS, rendered from locale files by the interface. Never a label.
    category: ticket.category,
    priority: ticket.priority,
    ratingOffered: state.ratingOffered,
    replyOffered: state.replyOffered,
    satisfaction: satisfaction
      ? {
          score: satisfaction.score,
          comment: satisfaction.comment,
          submittedAt: satisfaction.submitted_at,
        }
      : null,
    messages: messages.map((message) => ({
      direction: message.direction,
      channel: message.channel,
      occurredAt: message.occurred_at,
      body: message.body,
      attachments: attachments.get(message.id) ?? [],
    })),
  };
}

/**
 * Promotes outbound PORTAL messages to `read` (Phase 8, research.md D6).
 *
 * The one place in this project where `read` can be asserted truthfully with no
 * provider to ask, because the read happened against our own endpoint. Phase 5
 * built the delivery ladder because "`pending` and `sent` are NOT `delivered` —
 * an agent who believes an answer arrived stops chasing it"; using the honest
 * rung where it is genuinely knowable strengthens that rather than diluting it.
 *
 * ONLY THE PORTAL CHANNEL. An email we sent is not read because the customer
 * opened their portal, and claiming otherwise would be exactly the lie the
 * ladder exists to prevent.
 */
async function markOutboundRead(ticketId: number): Promise<void> {
  await Message.update(
    { delivery_state: DELIVERY_STATES.READ },
    {
      where: {
        ticket_id: ticketId,
        channel: CHANNELS.PORTAL,
        direction: 'outbound',
        delivery_state: { [Op.notIn]: [DELIVERY_STATES.READ, DELIVERY_STATES.FAILED] },
      },
    },
  );
}

// --- Writing ---------------------------------------------------------------

export interface PortalSubmissionInput {
  subject?: unknown;
  description?: unknown;
  category?: unknown;
  priority?: unknown;
}

/**
 * A customer raises a request (FR-019 - FR-025).
 *
 * DELEGATES TO `ticket.service.create`, which is the whole of FR-020. That
 * function records history, writes the audit row, emits `ticket.created` to the
 * automation engine, attaches SLA targets in the same transaction, and attempts
 * automatic assignment after the commit. A portal ticket must be an ORDINARY
 * ticket, and the only way to be sure of that is to create it the ordinary way —
 * a parallel creation path here would be a second place for those five things to
 * be forgotten.
 *
 * `customerId` AND `requestingContactId` COME FROM THE SESSION (FR-015, FR-026b).
 * There is no parameter for either on `PortalSubmissionInput`, so a caller cannot
 * supply one for the service to ignore — the safest version of "ignored" is
 * "impossible to express".
 *
 * THE ACTOR IS THE SYSTEM. `created_by_user_id` is null, exactly as it is for a
 * ticket raised from an inbound email (Phase 5, FR-026): nobody who works here
 * typed this. Read together with `source: 'portal'`, a null creator says
 * precisely what happened.
 */
export async function submit(
  session: PortalSessionContext,
  input: PortalSubmissionInput,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<{ reference: string }> {
  const details: ErrorDetail[] = [];

  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';

  if (subject === '') {
    details.push({ field: 'subject', message: 'portal.newRequest.error.subjectRequired' });
  }

  // REQUIRED HERE, though optional on a staff-created ticket. An agent typing a
  // ticket during a phone call has the context in their head; a customer's
  // description IS the context, and a request with none is a request somebody
  // has to phone back about — which is the thing this phase exists to avoid.
  if (description === '') {
    details.push({ field: 'description', message: 'portal.newRequest.error.descriptionRequired' });
  }

  // OPTIONAL FOR A CUSTOMER, unlike the staff form where both are mandatory. A
  // customer should not have to classify their own problem to be allowed to
  // report it. Where they do offer a value it is validated against Phase 3's
  // taxonomy and REFUSED if unknown — never coerced (FR-023), because silently
  // filing a billing complaint as "general" is worse than asking again.
  const category =
    input.category === undefined || input.category === '' ? 'general' : input.category;
  const priority =
    input.priority === undefined || input.priority === '' ? DEFAULT_PRIORITY : input.priority;

  if (!isTicketCategory(category)) {
    details.push({
      field: 'category',
      message: `ticket.error.categoryInvalid:${TICKET_CATEGORIES.join(',')}`,
    });
  }

  if (!isTicketPriority(priority)) {
    details.push({
      field: 'priority',
      message: `ticket.error.priorityInvalid:${TICKET_PRIORITIES.map((p) => p.key).join(',')}`,
    });
  }

  if (details.length > 0) throw validationError(details);

  const ticket = await ticketService.create(
    {
      customerId: session.customerId,
      subject,
      description,
      category,
      priority,
      source: 'portal',
      requestingContactId: session.contactId,
    },
    ticketService.SYSTEM_ACTOR,
    context,
  );

  // The reference and nothing else. The customer fetches the request they just
  // raised through the same scoped read as any other, rather than being handed a
  // projection assembled on a different path.
  return { reference: ticket.reference };
}

/**
 * A customer replies on an existing request (FR-034 - FR-036).
 *
 * GOES THROUGH `intake.service.accept` WITH `forceTicketId`, exactly as chat and
 * web forms do. That is what makes FR-035 true by construction rather than by
 * inspection: the reply gets the intake ledger, the `message.received` history
 * event, and the `message.received` automation trigger — the same behaviour as an
 * inbound message on any other channel, because it IS the same code.
 *
 * THE CLOSED BOUNDARY IS CHECKED FIRST, and nothing is stored if it fails
 * (FR-036). `TRANSITIONS` makes `closed -> open` need `tickets:reopen`, held only
 * by a Supervisor, "because closing finishes work and reopening undoes something
 * already finished". A customer reply that reopened a closed ticket would route
 * around that decision, so the reply is refused rather than accepted and left
 * unanswered.
 */
export async function reply(
  session: PortalSessionContext,
  reference: unknown,
  body: unknown,
): Promise<{ reference: string; reopened: boolean }> {
  const ticket = await findScoped(session, reference);
  const text = typeof body === 'string' ? body.trim() : '';

  if (text === '') {
    throw validationError([{ field: 'body', message: 'portal.reply.error.bodyRequired' }]);
  }

  if (text.length > PORTAL_MESSAGE_MAX_LENGTH) {
    throw validationError([
      { field: 'body', message: `portal.reply.error.bodyTooLong:${PORTAL_MESSAGE_MAX_LENGTH}` },
    ]);
  }

  // Refused BEFORE anything is written. FR-036 forbids accepting a message and
  // then discarding it, and a stored reply on a closed ticket that nobody will
  // ever answer is a discard with extra steps.
  if (!customerStateFor(ticket.status).replyOffered) throw ticketSettled();

  const message = buildInboundReply({ senderIdentity: session.email, body: text });

  const outcome = await intakeService.accept(
    message,
    // The "raw payload" the ledger stores. There is no provider envelope, so
    // this is the request as we understood it — enough to reprocess from, which
    // is what FR-038 wants the column for.
    JSON.stringify({ source: 'portal', contactId: session.contactId, body: text }),
    { forceTicketId: ticket.id },
  );

  if (outcome.status === 'failed') {
    throw validationError([{ field: 'body', message: 'portal.error.unexpected' }]);
  }

  const reopened = await reopenIfResolved(ticket);

  return { reference: toReference(ticket.id), reopened };
}

/**
 * Reopens a resolved request because the customer answered (research.md D9).
 *
 * THE TARGET STATUS IS A CONSTANT, and that is a security property rather than a
 * style choice. `lifecycleService` treats an actor with `id === null` as
 * permitted — the system actor bypasses the permission check — so a function that
 * accepted a target status from anywhere near a request would be a
 * customer-reachable path to any transition in the lifecycle. There is exactly
 * one edge here, written literally, invoked from one place.
 *
 * `closed` never reaches this: `reply` refuses it above.
 */
async function reopenIfResolved(ticket: Ticket): Promise<boolean> {
  // RE-READ, and the reason is the line below it. The reply that triggered this
  // went through intake, which may have run automation that moved the ticket —
  // so both the status and the VERSION have to come from now rather than from
  // the instance `findScoped` returned.
  const fresh = await Ticket.findByPk(ticket.id);

  if (!fresh || fresh.status !== 'resolved') return false;

  // `version` IS REQUIRED. `ticketService.transition` calls `assertVersion`, which
  // throws `staleRecord()` for a missing one — so omitting it made every reopen
  // answer 409 instead of reopening. Caught by `tests/portal/reply.test.ts`,
  // which is the whole argument for testing the journey rather than the unit:
  // nothing about the call site looked wrong.
  await ticketService.transition(
    fresh.id,
    { to: 'open', version: fresh.version },
    ticketService.SYSTEM_ACTOR,
  );

  return true;
}

// --- Attachments -----------------------------------------------------------

/**
 * A file on this contact's own correspondence (FR-033, research.md D15).
 *
 * THIS IS A NEW CAPABILITY, NOT A RE-SCOPING. `message-attachment.service`
 * exports `findForDownload(attachmentId)`, which does a bare `findByPk` and has
 * no caller and no route anywhere in the codebase: Phase 5 listed message
 * attachments without ever serving their bytes.
 *
 * So the shape here is chosen deliberately. THE SESSION COMES FIRST and the
 * attachment is reached THROUGH the scoped ticket — never `findByPk(attachmentId)`
 * followed by an ownership check, which is the arrangement Phase 2's controller
 * warns about: "serving it would make an attachment reachable by anyone who
 * obtains its address, which is the same defect as not checking permission at
 * all."
 *
 * The join to `messages` is what excludes an internal, agent-uploaded file: those
 * live in `customer_attachments` and have no `message_id`, so they are not
 * reachable from here at all. Belt and braces — the exclusion is structural
 * rather than filtered.
 */
export async function attachmentFor(
  session: PortalSessionContext,
  reference: unknown,
  attachmentId: unknown,
): Promise<{ messageId: number; attachmentId: number }> {
  const ticket = await findScoped(session, reference);
  const id = Number(attachmentId);

  if (!Number.isInteger(id) || id < 1) throw notFound();

  const message = await Message.findOne({
    where: { ticket_id: ticket.id },
    include: [{ association: 'attachments', required: true, where: { id } }],
  });

  if (!message) throw notFound();

  return { messageId: message.id, attachmentId: id };
}
