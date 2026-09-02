import { Op, literal, type WhereOptions } from 'sequelize';

import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import {
  customerInactive,
  notFound,
  staleRecord,
  ticketClosed,
  validationError,
  type ErrorDetail,
} from '../errors/app-error.js';
import { now as clockNow } from '../lib/clock.js';
import { logger } from '../middleware/request-logger.js';
import {
  Customer,
  CustomerContact,
  SlaPolicy,
  Ticket,
  TicketLink,
  TicketSatisfaction,
  TicketSla,
  User,
} from '../models/index.js';
import { isTicketSource } from '../models/ticket.model.js';
import { INITIAL_STATUS, type TicketStatus } from '../tickets/lifecycle.js';
import { parseReference, toReference } from '../tickets/reference.js';
import {
  isTicketCategory,
  isTicketPriority,
  prioritySortExpression,
  TICKET_CATEGORIES,
  allPriorityKeys,
  type TicketCategory,
  type TicketPriority,
} from '../tickets/taxonomy.js';

import * as automationEngine from './automation-engine.service.js';
import * as auditService from './audit.service.js';
import * as authorizationService from './authorization.service.js';
import * as notificationService from './notification.service.js';
import * as slaTargetService from './sla-target.service.js';
import * as similarTicketService from './similar-ticket.service.js';
import * as taskService from './task.service.js';
import type { TaskView } from './task.service.js';
import * as historyService from './ticket-history.service.js';
import * as lifecycleService from './ticket-lifecycle.service.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * WHO IS ACTING — a person, or the system.
 *
 * `id: null` MEANS THE SYSTEM (Phase 6, research.md D8). Phase 5 already made
 * the DATA nullable in three columns — `tickets.created_by_user_id`,
 * `ticket_history.actor_user_id`, `ticket_links.created_by_user_id` — because
 * intake raises tickets nobody typed. This is the last place the code still
 * claimed every act has a person behind it.
 *
 * Widening it is what lets Phase 6's automation call THESE SERVICES rather than
 * writing models directly. That is the whole point: a rule that changed a
 * status by writing the model would bypass `TRANSITIONS`, and one that assigned
 * by writing the model would bypass the active-and-permitted assignee check.
 * A second enforcement path is precisely the failure Phase 3's generated matrix
 * exists to catch.
 *
 * CONTROLLERS ARE UNAFFECTED: a request always carries a real actor. Only the
 * scheduler, the intake path, and the rule executor pass a system actor.
 *
 * Permission-conditional branches treat a system actor as PERMITTED. That is
 * not a bypass: automation's gate is the closed-ended action catalog
 * (automation/catalog.ts) plus the authority of the user who configured the
 * rule. There is no request, no role, and no route middleware in the path — so
 * a role lookup on a null role would be asking a question with no meaning.
 */
export interface Actor {
  id: number | null;
  email: string | null;
  fullName: string;
  roleId: number | null;
}

/**
 * A PERSON, REQUIRED.
 *
 * Some work has no meaning without one, and saying so in the type is better
 * than checking for null in the body. A task belongs to its owner (Phase 4
 * Clarifications Q3 made tasks personal), a note has an author, a template has
 * an editor, a queue belongs to whoever is looking at it. The automation
 * catalog deliberately contains no action that reaches any of them — there is
 * no `create_task`, precisely because there is no such thing as a task the
 * system owns.
 *
 * So these services keep demanding a person, and the compiler enforces it. That
 * is the difference between a widened type and a weakened one.
 */
export interface UserActor {
  id: number;
  email: string;
  fullName: string;
  roleId: number;
}

/** True when the system is acting rather than a person. */
export function isSystemActor(actor: { id: number | null }): boolean {
  return actor.id === null;
}

/**
 * The actor the scheduler, intake, and rule executor pass.
 *
 * `fullName` is an i18n KEY rather than a sentence, so an Arabic reader is not
 * shown the English word "System" — the same rule Phase 5 applied to
 * `SYSTEM_ACTOR` in ticket-history.service.ts, and Phase 4 to notification rows.
 */
export const SYSTEM_ACTOR: Actor = {
  id: null,
  email: null,
  fullName: 'ticket.history.actor.system',
  roleId: null,
};

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TicketSummary {
  id: number;
  /** Derived from the primary key, never stored — see tickets/reference.ts. */
  reference: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  customer: { id: number; displayName: string; isActive: boolean } | null;
  assignee: { id: number; fullName: string; isActive: boolean } | null;
  mergedIntoTicketId: number | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketLinkView {
  id: number;
  ticket: { id: number; reference: string; subject: string; status: TicketStatus };
}

export interface TicketDetail extends TicketSummary {
  description: string | null;
  escalationReason: string | null;
  createdBy: { id: number; fullName: string } | null;
  links: TicketLinkView[];
  /** Where a merged ticket redirects to, resolved through the whole chain. */
  survivor: { id: number; reference: string } | null;
  /**
   * Phase 4 (FR-064). Present ONLY on the response to a close that left open
   * follow-ups behind, so the interface can surface them. Its absence means
   * there were none — it is a notice, never a refusal.
   */
  outstandingTasks?: TaskView[];
  /**
   * Phase 6 (FR-020). NULL for a ticket that matched no policy (FR-014) — not
   * an object of nulls, so no consumer can render a countdown for a commitment
   * nobody made.
   */
  sla: slaTargetService.SlaView | null;
  /**
   * WHO CAN SEE THIS CONVERSATION IN THE PORTAL (Phase 8, FR-026i).
   *
   * Shown to agents because it answers a question they will otherwise guess at.
   * Without it, "the customer says they cannot find their ticket" has no visible
   * cause — the ticket is right there on the agent's screen, and the reason it is
   * missing from the customer's is a column nobody can see.
   *
   * NULL means nobody sees it in the portal (FR-026f), which is the state most
   * historical tickets are in until somebody associates them.
   */
  requestingContact: { id: number; email: string } | null;
  /**
   * The customer's rating of the resolution (Phase 8, FR-053).
   *
   * NULL means not rated — which covers both "not asked yet" and "asked and
   * ignored", and deliberately does not distinguish them. Nothing records that
   * we invited a rating, because nothing needs to: FR-051 requires that ignoring
   * the invitation creates nothing at all.
   */
  satisfaction: { score: number; comment: string | null; submittedAt: Date } | null;
}

type Loaded = Ticket & { customer?: Customer; assignee?: User | null; createdBy?: User | null };

function toSummary(ticket: Loaded): TicketSummary {
  return {
    id: ticket.id,
    reference: toReference(ticket.id),
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    customer: ticket.customer
      ? {
          id: ticket.customer.id,
          displayName: ticket.customer.display_name,
          isActive: ticket.customer.is_active,
        }
      : null,
    assignee: ticket.assignee
      ? {
          id: ticket.assignee.id,
          fullName: ticket.assignee.full_name,
          isActive: ticket.assignee.is_active,
        }
      : null,
    mergedIntoTicketId: ticket.merged_into_ticket_id,
    version: ticket.version,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
  };
}

export function clampPageSize(requested: unknown): number {
  const value = Number(requested);

  return Number.isFinite(value) && value >= 1
    ? Math.min(Math.floor(value), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
}

function clampPage(requested: unknown): number {
  const value = Number(requested);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

const SUMMARY_INCLUDE = [
  { model: Customer, as: 'customer' },
  { model: User, as: 'assignee' },
];

async function loadTicket(id: number): Promise<Loaded> {
  const ticket = (await Ticket.findByPk(id, {
    include: [...SUMMARY_INCLUDE, { model: User, as: 'createdBy' }],
  })) as Loaded | null;

  if (!ticket) {
    throw notFound();
  }

  return ticket;
}

/**
 * Optimistic locking (FR-010). A missing version is as much a conflict as a
 * wrong one — a client that does not send it has not read the record it is
 * overwriting.
 */
function assertVersion(ticket: Ticket, provided: unknown): void {
  const version = Number(provided);

  if (!Number.isInteger(version) || version !== ticket.version) {
    throw staleRecord();
  }
}

// --- Listing -------------------------------------------------------------

export interface ListOptions {
  q?: string;
  status?: string[];
  priority?: string[];
  category?: string[];
  assigneeId?: number | 'unassigned';
  customerId?: number;
  /**
   * Creation-date bounds, as absolute instants (Phase 10, FR-001, FR-034).
   *
   * Added for reporting drill-through. Every figure in a report is scoped to a
   * period, so a drill-through that could only filter by assignee would land on
   * a list containing tickets the figure did not count — and a check that
   * disagrees with the number it is checking is worse than no check, because
   * nobody can tell which of the two is wrong.
   *
   * Instants rather than date strings, resolved by the caller: the report
   * already resolved the period in the configured timezone, and re-parsing a
   * date here would be a second timezone decision.
   */
  createdFrom?: Date;
  createdTo?: Date;
  sort?: string;
  includeMerged?: boolean;
  page?: unknown;
  pageSize?: unknown;
}

const SORTABLE = new Set(['createdAt', 'updatedAt', 'priority']);

function orderFor(sort: string | undefined): [string | ReturnType<typeof literal>, string][] {
  const raw = sort ?? '-updatedAt';
  const descending = raw.startsWith('-');
  const field = descending ? raw.slice(1) : raw;
  const direction = descending ? 'DESC' : 'ASC';

  if (!SORTABLE.has(field)) {
    return [
      ['updated_at', 'DESC'],
      ['id', 'DESC'],
    ];
  }

  if (field === 'priority') {
    // By RANK, not alphabetically — alphabetical order puts `urgent` below
    // `normal`, which is precisely backwards.
    return [
      [literal(prioritySortExpression()), direction],
      ['id', 'DESC'],
    ];
  }

  const column = field === 'createdAt' ? 'created_at' : 'updated_at';

  // `id` is the tiebreaker: MySQL DATETIME is second-precision, so tickets
  // created in the same second would otherwise come back in no defined order.
  return [
    [column, direction],
    ['id', 'DESC'],
  ];
}

export async function list(options: ListOptions = {}): Promise<Paged<TicketSummary>> {
  const pageSize = clampPageSize(options.pageSize);
  const page = clampPage(options.page);

  const where: WhereOptions & Record<string, unknown> = {};

  if (options.status?.length) where.status = options.status;
  if (options.priority?.length) where.priority = options.priority;
  if (options.category?.length) where.category = options.category;
  if (options.customerId !== undefined) where.customer_id = options.customerId;

  if (options.createdFrom && options.createdTo) {
    where.created_at = { [Op.between]: [options.createdFrom, options.createdTo] };
  } else if (options.createdFrom) {
    where.created_at = { [Op.gte]: options.createdFrom };
  } else if (options.createdTo) {
    where.created_at = { [Op.lte]: options.createdTo };
  }

  if (options.assigneeId === 'unassigned') {
    where.assignee_user_id = null;
  } else if (typeof options.assigneeId === 'number') {
    where.assignee_user_id = options.assigneeId;
  }

  // Merged tickets are absent from the working list by default (FR-044): they
  // are redirects, and a queue full of redirects is not a queue.
  if (!options.includeMerged) {
    where.merged_into_ticket_id = null;
  }

  const search = options.q?.trim();

  if (search) {
    const referenceId = parseReference(search);

    // Reference search is an EXACT id lookup, which is the payoff for deriving
    // the reference from the primary key rather than storing it. Subject
    // matching is a LIKE, accent- and case-insensitive through the collation
    // (FR-024) — Arabic and mixed-case work with no special handling.
    where[Op.or as unknown as string] = [
      ...(referenceId === null ? [] : [{ id: referenceId }]),
      { subject: { [Op.like]: `%${search}%` } },
    ];
  }

  const { rows, count } = await Ticket.findAndCountAll({
    where,
    include: SUMMARY_INCLUDE,
    order: orderFor(options.sort) as never,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    // The includes are hasOne/belongsTo, so no row multiplication — but being
    // explicit keeps the count honest if an association is added later.
    distinct: true,
  });

  return {
    items: rows.map((row) => toSummary(row as Loaded)),
    page,
    pageSize,
    total: count,
  };
}

// --- Reading -------------------------------------------------------------

async function linksFor(ticketId: number): Promise<TicketLinkView[]> {
  const rows = await TicketLink.findAll({
    where: {
      [Op.or]: [{ ticket_id: ticketId }, { linked_ticket_id: ticketId }],
    },
  });

  const otherIds = rows.map((row) =>
    row.ticket_id === ticketId ? row.linked_ticket_id : row.ticket_id,
  );

  if (otherIds.length === 0) return [];

  const others = await Ticket.findAll({ where: { id: otherIds } });
  const byId = new Map(others.map((other) => [other.id, other]));

  return rows.flatMap((row) => {
    const otherId = row.ticket_id === ticketId ? row.linked_ticket_id : row.ticket_id;
    const other = byId.get(otherId);

    if (!other) return [];

    return [
      {
        id: row.id,
        ticket: {
          id: other.id,
          reference: toReference(other.id),
          subject: other.subject,
          status: other.status,
        },
      },
    ];
  });
}

export async function getById(id: number): Promise<TicketDetail> {
  const ticket = await loadTicket(id);

  const survivorId =
    ticket.merged_into_ticket_id === null ? null : await lifecycleService.resolveSurvivorId(ticket);

  const requestingContact =
    ticket.requesting_contact_id === null
      ? null
      : await CustomerContact.findByPk(ticket.requesting_contact_id, {
          attributes: ['id', 'value_raw'],
        });

  const satisfaction = await TicketSatisfaction.findOne({ where: { ticket_id: ticket.id } });

  return {
    ...toSummary(ticket),
    description: ticket.description,
    escalationReason: ticket.escalation_reason,
    createdBy: ticket.createdBy
      ? { id: ticket.createdBy.id, fullName: ticket.createdBy.full_name }
      : null,
    links: await linksFor(ticket.id),
    survivor: survivorId === null ? null : { id: survivorId, reference: toReference(survivorId) },
    sla: await slaFor(ticket),
    requestingContact: requestingContact
      ? { id: requestingContact.id, email: requestingContact.value_raw }
      : null,
    satisfaction: satisfaction
      ? {
          score: satisfaction.score,
          comment: satisfaction.comment,
          submittedAt: satisfaction.submitted_at,
        }
      : null,
  };
}

/**
 * The ticket's SLA state (Phase 6, FR-020).
 *
 * NO NEW PERMISSION: it rides on `tickets:view` and is returned WITH the
 * ticket. A key every role holds unconditionally cannot refuse anything — the
 * reasoning that kept `notifications:view` out of Phase 4's catalog and
 * `timeline:view` out of Phase 5's.
 *
 * Returns null for a ticket that matched no policy (FR-014) — not an object of
 * nulls, so nothing downstream can render "0 minutes remaining" about a
 * commitment nobody made.
 */
async function slaFor(ticket: Ticket): Promise<slaTargetService.SlaView | null> {
  const row = await TicketSla.findByPk(ticket.id);

  if (!row) return null;

  const policy = row.policy_id === null ? null : await SlaPolicy.findByPk(row.policy_id);

  return slaTargetService.viewFor(ticket, row, policy?.name ?? null, env.SLA_WARNING_LEAD_MINUTES);
}

/** The moves available to this actor on this ticket (FR-017). */
export async function transitionsFor(
  id: number,
  actor: Actor,
): Promise<{ status: TicketStatus; transitions: TicketStatus[] }> {
  const ticket = await loadTicket(id);

  return {
    status: ticket.status,
    transitions: await lifecycleService.availableTransitions(actor, ticket),
  };
}

// --- Creating ------------------------------------------------------------

export interface TicketInput {
  customerId?: unknown;
  subject?: unknown;
  description?: unknown;
  category?: unknown;
  priority?: unknown;
  version?: unknown;
  /**
   * Where the ticket came from (Phase 5's `TICKET_SOURCES`). Defaults to
   * `manual`, so every existing caller is unchanged.
   *
   * HONOURED ONLY FOR A SYSTEM ACTOR — see `create` below. The staff controller
   * passes `req.body` straight through, so without that rule an agent could post
   * `source: 'portal'` and make a ticket they typed claim a customer raised it.
   * Nothing breaks if they do, but `source` is the column an administrator reads
   * to ask "which of these arrived on their own?", and an answer that can be
   * typed is not an answer.
   */
  source?: unknown;
  /**
   * WHICH CONTACT RAISED IT (Phase 8, FR-026a, FR-026e).
   *
   * Optional, and allowed to stay null: an agent raising a ticket during a phone
   * call may not know. NULL means nobody sees it in the portal (FR-026f), which
   * is the correct fail-closed default for a ticket whose requester is unknown.
   *
   * Validated against THIS ticket's customer below. A contact on another
   * customer's record would be a cross-customer disclosure, and the foreign key
   * cannot express the constraint.
   */
  requestingContactId?: unknown;
}

function validateTaxonomy(input: TicketInput, details: ErrorDetail[]): void {
  if (!isTicketCategory(input.category)) {
    // Names the accepted values, so the caller is not left guessing at a
    // closed set they cannot discover.
    details.push({
      field: 'category',
      message: `ticket.error.categoryInvalid:${TICKET_CATEGORIES.join(',')}`,
    });
  }

  if (!isTicketPriority(input.priority)) {
    details.push({
      field: 'priority',
      message: `ticket.error.priorityInvalid:${allPriorityKeys().join(',')}`,
    });
  }
}

/**
 * Resolves and validates a requesting contact (Phase 8, FR-026a, FR-026h).
 *
 * THE ONLY PLACE either write path checks it, so "the contact must belong to this
 * ticket's customer" has one implementation. That rule is not decoration: an
 * association across customers would make one customer's conversation visible in
 * another customer's portal, which is the worst outcome this phase has.
 */
async function resolveRequestingContact(
  value: unknown,
  customerId: number,
): Promise<number | null> {
  if (value === undefined || value === null || value === '') return null;

  const contactId = Number(value);

  if (!Number.isInteger(contactId) || contactId < 1) {
    throw validationError([
      { field: 'requestingContactId', message: 'ticket.error.requestingContactInvalid' },
    ]);
  }

  const contact = await CustomerContact.findOne({
    where: { id: contactId, customer_id: customerId },
    attributes: ['id'],
  });

  // Refused rather than silently ignored. A caller who named the wrong contact
  // has a bug, and quietly storing NULL would hide it behind a portal that
  // simply never shows the ticket.
  if (!contact) {
    throw validationError([
      { field: 'requestingContactId', message: 'ticket.error.requestingContactNotOnCustomer' },
    ]);
  }

  return contact.id;
}

/**
 * Records which contact raised an existing ticket (Phase 8, FR-026h, FR-057a).
 *
 * The manual route out of Clarifications Q2's fail-closed rule: every ticket that
 * predates this phase and could not be associated deterministically is invisible
 * in the portal until somebody says whose it was.
 *
 * AUDITED AS A DISCLOSURE, not as an edit. `portal.ticket.contact_associated` is
 * the key that answers "why can this person see that conversation?" — the
 * question Q2's whole design exists to keep answerable.
 */
export async function setRequestingContact(
  ticketId: number,
  contactId: unknown,
  actor: UserActor,
  context: AuditContext = {},
): Promise<TicketDetail> {
  const ticket = await Ticket.findByPk(ticketId);

  if (!ticket) throw notFound();

  const resolved = await resolveRequestingContact(contactId, ticket.customer_id);
  const previous = ticket.requesting_contact_id;

  await sequelize.transaction(async (transaction) => {
    ticket.requesting_contact_id = resolved;
    await ticket.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PORTAL_TICKET_CONTACT_ASSOCIATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        previousValue: { requestingContactId: previous },
        newValue: { requestingContactId: resolved },
        ...context,
      },
      transaction,
    );
  });

  return getById(ticket.id);
}

export async function create(
  input: TicketInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<TicketDetail> {
  const details: ErrorDetail[] = [];

  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (subject === '') {
    details.push({ field: 'subject', message: 'ticket.error.subjectRequired' });
  }

  const customerId = Number(input.customerId);
  if (!Number.isInteger(customerId) || customerId < 1) {
    details.push({ field: 'customerId', message: 'ticket.error.customerRequired' });
  }

  validateTaxonomy(input, details);

  if (details.length > 0) {
    throw validationError(details);
  }

  const customer = await Customer.findByPk(customerId);

  if (!customer) {
    throw validationError([{ field: 'customerId', message: 'ticket.error.customerNotFound' }]);
  }

  // A deactivated customer takes no NEW tickets (FR-007), though an existing
  // ticket stays workable if its customer is deactivated later (FR-008).
  if (!customer.is_active) {
    throw customerInactive();
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';

  // Phase 8, FR-026a. Resolved BEFORE the transaction so a bad contact is a 400
  // rather than a rolled-back ticket, and checked against THIS customer because
  // the foreign key cannot express that constraint (FR-026h).
  const requestingContactId = await resolveRequestingContact(
    input.requestingContactId,
    customer.id,
  );

  const created = await sequelize.transaction(async (transaction) => {
    const ticket = await Ticket.create(
      {
        customer_id: customer.id,
        subject,
        description: description === '' ? null : description,
        category: input.category as TicketCategory,
        priority: input.priority as TicketPriority,
        // NEVER accepted from the caller. A client that could post
        // status: 'closed' would have bypassed the entire lifecycle.
        status: INITIAL_STATUS,
        assignee_user_id: null,
        created_by_user_id: actor.id,
        // A PERSON'S TICKET IS ALWAYS `manual`, whatever the body said. Only a
        // system actor — the portal service, or intake — may name a source, and
        // each passes a literal it decided itself rather than one it was handed
        // (Phase 8).
        source: actor.id === null && isTicketSource(input.source) ? input.source : 'manual',
        requesting_contact_id: requestingContactId,
      },
      { transaction },
    );

    await historyService.record(
      { ticketId: ticket.id, event: historyService.TICKET_EVENTS.CREATED, actor },
      transaction,
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.TICKET_CREATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        metadata: { customerId: customer.id, category: ticket.category, priority: ticket.priority },
        ...context,
      },
      transaction,
    );

    // Phase 6 (FR-056). Registered on the transaction, so rules see a ticket
    // that definitely exists — nothing evaluates before the commit.
    automationEngine.emit(
      { trigger: 'ticket.created', ticketId: ticket.id, actorUserId: actor.id },
      transaction,
    );

    // Phase 6 (FR-010): the ticket acquires its SLA targets the moment it
    // exists, in the same transaction. A ticket that matches no policy gets no
    // row at all, which is FR-014 made structural rather than checked.
    // `?? clockNow()` for the same reason `mirrorDueDate` normalises: a freshly
    // created instance may not have `created_at` populated yet, and the clock
    // must never start from `undefined`.
    await slaTargetService.attachTargets(ticket, transaction, ticket.created_at ?? clockNow());

    return ticket;
  });

  // Phase 6 (FR-043). AFTER THE COMMIT, deliberately: automatic assignment
  // reads the eligible agents' current load, and doing that inside the
  // creating transaction would count this very ticket inconsistently. It also
  // must not be able to fail the creation — a ticket that exists unassigned is
  // a supervision problem; a ticket that failed to be raised is a lost customer.
  await autoAssignQuietly(created.id);

  // Phase 9: propose a category, off the request path (FR-004).
  //
  // NOT AWAITED, and that is the difference from assignment above. Assignment
  // decides who works the ticket and is worth a moment of the caller's time;
  // a category PROPOSAL changes nothing about the ticket (Clarifications Q2),
  // so making an intake request wait on a model call would be spending a
  // customer's latency on advice nobody has read yet. The service never
  // throws to its caller, and the invocation record holds any failure.
  void classifyQuietly(created.id);

  return getById(created.id);
}

/** Propose a category without ever affecting what triggered it. */
async function classifyQuietly(ticketId: number): Promise<void> {
  try {
    const classifyService = await import('./ai-classify.service.js');
    await classifyService.proposeFor(ticketId);
  } catch (error) {
    logger.error({ err: error, ticketId }, 'Category classification failed for a new ticket');
  }
}

/**
 * Attempt automatic assignment, and never let it break what triggered it.
 *
 * Where no eligible agent exists the ticket stays unassigned, the reason is
 * recorded, and the supervisory recipients are alerted (FR-048) — the ticket
 * does not vanish into an unwatched state. That alert is dispatched here rather
 * than inside `assignment.service` so the service stays a decision-maker and
 * this stays the place that knows a NEW ticket is involved.
 */
async function autoAssignQuietly(ticketId: number): Promise<void> {
  try {
    const assignmentService = await import('./assignment.service.js');
    const outcome = await assignmentService.autoAssign(ticketId);

    // `strategy_off`, `already_assigned` and `not_workable` are ordinary
    // outcomes, not problems. Only "there was work and nobody to give it to"
    // is worth waking a supervisor for.
    if (outcome.refusal === 'no_eligible_agent' || outcome.refusal === 'all_at_ceiling') {
      const alertService = await import('./alert.service.js');
      const { ALERT_EVENTS } = await import('../models/alert-subscription.model.js');

      await sequelize.transaction(async (transaction) => {
        await alertService.dispatch(
          ALERT_EVENTS.ASSIGNMENT_FAILED,
          { ticketId, assigneeUserId: null, params: { reason: outcome.refusal } },
          transaction,
        );
      });
    }
  } catch (error) {
    // Never propagates. The ticket is already created and the customer already
    // has one; a routing failure is a supervision problem, not a request one.
    logger.error({ err: error, ticketId }, 'Automatic assignment failed for a new ticket');
  }
}

// --- Editing -------------------------------------------------------------

/**
 * The ONLY fields an edit may touch. `status` is deliberately absent: status
 * changes go through the transition endpoint, so the lifecycle cannot be
 * bypassed by an edit (FR-017).
 */
type EditableField = 'subject' | 'description' | 'category' | 'priority';

export async function update(
  id: number,
  input: TicketInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<TicketDetail> {
  const ticket = await loadTicket(id);

  // Merged first: it holds regardless of what the edit asked for.
  await lifecycleService.assertWorkable(ticket);

  // A closed ticket is finished. Reopening is the way back, not an edit
  // (FR-009). Both checks live HERE so every route inherits them.
  if (ticket.status === 'closed') {
    throw ticketClosed();
  }

  assertVersion(ticket, input.version);

  const details: ErrorDetail[] = [];
  const changes: Array<{ field: string; previous: string | null; next: string | null }> = [];

  if (input.subject !== undefined) {
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    if (subject === '') {
      details.push({ field: 'subject', message: 'ticket.error.subjectRequired' });
    } else if (subject !== ticket.subject) {
      changes.push({ field: 'subject', previous: ticket.subject, next: subject });
    }
  }

  if (input.description !== undefined) {
    const raw = typeof input.description === 'string' ? input.description.trim() : '';
    const next = raw === '' ? null : raw;
    if (next !== ticket.description) {
      changes.push({ field: 'description', previous: ticket.description, next });
    }
  }

  if (input.category !== undefined) {
    if (!isTicketCategory(input.category)) {
      details.push({
        field: 'category',
        message: `ticket.error.categoryInvalid:${TICKET_CATEGORIES.join(',')}`,
      });
    } else if (input.category !== ticket.category) {
      changes.push({ field: 'category', previous: ticket.category, next: input.category });
    }
  }

  if (input.priority !== undefined) {
    if (!isTicketPriority(input.priority)) {
      details.push({
        field: 'priority',
        message: `ticket.error.priorityInvalid:${allPriorityKeys().join(',')}`,
      });
    } else if (input.priority !== ticket.priority) {
      changes.push({ field: 'priority', previous: ticket.priority, next: input.priority });
    }
  }

  // `status` is NOT in EDITABLE and is not read here. Status changes go through
  // the transition endpoint, so the lifecycle cannot be bypassed by an edit.
  if ('status' in input) {
    details.push({ field: 'status', message: 'ticket.error.statusNotEditable' });
  }

  if (details.length > 0) {
    throw validationError(details);
  }

  if (changes.length === 0) {
    return getById(ticket.id);
  }

  await sequelize.transaction(async (transaction) => {
    for (const change of changes) {
      ticket.set(change.field as EditableField, change.next);
    }

    await ticket.save({ transaction });

    // One history entry PER CHANGED FIELD (FR-033), each carrying what it was
    // and what it became.
    await historyService.recordAll(
      changes.map((change) => ({
        ticketId: ticket.id,
        event: historyService.TICKET_EVENTS.UPDATED,
        actor,
        field: change.field,
        previousValue: change.previous,
        newValue: change.next,
      })),
      transaction,
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.TICKET_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        previousValue: Object.fromEntries(changes.map((c) => [c.field, c.previous])),
        newValue: Object.fromEntries(changes.map((c) => [c.field, c.next])),
        ...context,
      },
      transaction,
    );

    // Phase 6 (FR-017): a priority or category change may put this ticket under
    // a DIFFERENT policy, so its targets are recomputed — from the original
    // start time and accumulated pause, so elapsed time is neither forgiven nor
    // charged twice. Nothing else in this edit can change which policy matches.
    const changedScope = changes.some(
      (change) => change.field === 'priority' || change.field === 'category',
    );

    if (changedScope) {
      await slaTargetService.recompute(ticket, transaction);
    }

    const priorityChange = changes.find((change) => change.field === 'priority');

    if (priorityChange) {
      automationEngine.emit(
        {
          trigger: 'ticket.priority_changed',
          ticketId: ticket.id,
          actorUserId: actor.id,
          from: priorityChange.previous as TicketPriority,
          to: priorityChange.next as TicketPriority,
        },
        transaction,
      );
    }
  });

  return getById(ticket.id);
}

// --- Transitions ---------------------------------------------------------

export interface TransitionInput {
  to?: unknown;
  version?: unknown;
  reason?: unknown;
  note?: unknown;
}

/**
 * The audit action a given edge deserves.
 *
 * Closing and reopening get their own keys rather than being folded into
 * `ticket.status.changed`, because an administrator scanning the audit log for
 * "what was undone" should not have to read the previous and new values of
 * every status change to find it.
 */
function auditActionFor(from: TicketStatus, to: TicketStatus): auditService.AuditAction {
  if (to === 'closed') return auditService.AUDIT_ACTIONS.TICKET_CLOSED;
  if (from === 'closed' && to === 'open') return auditService.AUDIT_ACTIONS.TICKET_REOPENED;
  if (to === 'escalated') return auditService.AUDIT_ACTIONS.TICKET_ESCALATED;
  if (from === 'escalated') return auditService.AUDIT_ACTIONS.TICKET_DEESCALATED;
  return auditService.AUDIT_ACTIONS.TICKET_STATUS_CHANGED;
}

function historyEventFor(from: TicketStatus, to: TicketStatus): historyService.TicketEvent {
  if (to === 'closed') return historyService.TICKET_EVENTS.CLOSED;
  if (from === 'closed' && to === 'open') return historyService.TICKET_EVENTS.REOPENED;
  if (to === 'escalated') return historyService.TICKET_EVENTS.ESCALATED;
  if (from === 'escalated') return historyService.TICKET_EVENTS.DEESCALATED;
  return historyService.TICKET_EVENTS.STATUS_CHANGED;
}

export async function transition(
  id: number,
  input: TransitionInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<TicketDetail> {
  const ticket = await loadTicket(id);

  // The gate. Merged, then declared, then permitted — in that order.
  const edge = await lifecycleService.assertTransitionAllowed(ticket, input.to, actor);

  assertVersion(ticket, input.version);

  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';

  // Escalation must say why (FR-029). An escalation with no reason is a status
  // nobody downstream can act on.
  if (edge.to === 'escalated' && reason === '') {
    throw validationError([{ field: 'reason', message: 'ticket.error.escalationReasonRequired' }]);
  }

  const note =
    typeof input.note === 'string' && input.note.trim() !== '' ? input.note.trim() : null;

  await sequelize.transaction(async (transaction) => {
    ticket.status = edge.to;

    if (edge.to === 'escalated') {
      ticket.escalation_reason = reason;
    } else if (edge.from === 'escalated') {
      // Leaving escalation clears the reason: it describes what is true now,
      // not what was ever true. The full record stays in the history.
      ticket.escalation_reason = null;
    }

    await ticket.save({ transaction });

    await historyService.record(
      {
        ticketId: ticket.id,
        event: historyEventFor(edge.from, edge.to),
        actor,
        field: 'status',
        previousValue: edge.from,
        newValue: edge.to,
        note: edge.to === 'escalated' ? reason : note,
      },
      transaction,
    );

    await auditService.record(
      {
        action: auditActionFor(edge.from, edge.to),
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        previousValue: { status: edge.from },
        newValue: { status: edge.to },
        metadata: edge.to === 'escalated' ? { reason } : undefined,
        ...context,
      },
      transaction,
    );

    // Phase 6: the SLA clock starts, stops, satisfies, and re-arms on THESE
    // transitions and no others (FR-021, FR-023, FR-030). The classification
    // lives in sla/clock.ts, derived from this same lifecycle — there is
    // deliberately no second state machine to keep in step.
    await slaTargetService.onStatusChange(ticket, edge.from, edge.to, clockNow(), transaction);

    // Phase 9: keep the similar-ticket index in step with the lifecycle
    // (research D8). Inside the transaction, following Phase 7's reindex
    // pattern, so the index cannot disagree with the row that produced it.
    // Reindexing on EVERY transition rather than only into a settled state:
    // leaving `resolved` must remove the rows, or a reopened ticket would go on
    // being suggested as though it had an answer.
    await similarTicketService.reindex(ticket.id, transaction);

    automationEngine.emit(
      {
        trigger: 'ticket.status_changed',
        ticketId: ticket.id,
        actorUserId: actor.id,
        from: edge.from,
        to: edge.to,
      },
      transaction,
    );
  });

  // Reopening RETAINS ALL HISTORY (FR-022) — nothing above deletes anything,
  // which is the whole implementation of that requirement.
  const detail = await getById(ticket.id);

  // Phase 4 (FR-064). Closing a ticket that still has open follow-ups SURFACES
  // them; it never refuses. The person closing may well know the task is moot,
  // and blocking them would teach everyone to stop recording follow-ups. This
  // reports so they can decide.
  if (ticket.status === 'closed') {
    const outstanding = await taskService.outstandingForTicket(ticket.id);

    if (outstanding.length > 0) {
      return { ...detail, outstandingTasks: outstanding };
    }
  }

  return detail;
}

// --- Assignment ----------------------------------------------------------

export interface AssignInput {
  userId?: unknown;
  version?: unknown;
}

/**
 * Supervisor-only (Clarifications Q3). An Agent cannot assign a ticket to
 * anyone, INCLUDING THEMSELVES — there is no claim action, which is why Phase
 * 4's dashboard is read-only with respect to assignment.
 */
export async function assign(
  id: number,
  input: AssignInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<TicketDetail> {
  const ticket = await loadTicket(id);

  await lifecycleService.assertWorkable(ticket);
  assertVersion(ticket, input.version);

  const raw = input.userId;
  const unassigning = raw === null;
  let target: User | null = null;

  if (!unassigning) {
    const userId = Number(raw);

    if (!Number.isInteger(userId) || userId < 1) {
      throw validationError([{ field: 'userId', message: 'ticket.error.assigneeInvalid' }]);
    }

    target = await User.findByPk(userId);

    if (!target || !target.is_active) {
      throw validationError([{ field: 'userId', message: 'ticket.error.assigneeInactive' }]);
    }

    // Assigning work to someone who cannot open it is a silent dead end.
    if (!(await authorizationService.roleHasPermission(target.role_id, 'tickets:view'))) {
      throw validationError([{ field: 'userId', message: 'ticket.error.assigneeCannotView' }]);
    }
  }

  const previousId = ticket.assignee_user_id;
  const nextId = unassigning ? null : (target as User).id;

  if (previousId === nextId) {
    return getById(ticket.id);
  }

  const previousUser = previousId === null ? null : await User.findByPk(previousId);

  await sequelize.transaction(async (transaction) => {
    ticket.assignee_user_id = nextId;
    await ticket.save({ transaction });

    await historyService.record(
      {
        ticketId: ticket.id,
        event:
          nextId === null
            ? historyService.TICKET_EVENTS.UNASSIGNED
            : historyService.TICKET_EVENTS.ASSIGNED,
        actor,
        field: 'assignee',
        // Both sides recorded (FR-026): reassignment is only legible if the
        // history says who it came from as well as who it went to.
        previousValue: previousUser?.full_name ?? null,
        newValue: target?.full_name ?? null,
      },
      transaction,
    );

    await auditService.record(
      {
        action:
          nextId === null
            ? auditService.AUDIT_ACTIONS.TICKET_UNASSIGNED
            : auditService.AUDIT_ACTIONS.TICKET_ASSIGNED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        previousValue: { assigneeUserId: previousId },
        newValue: { assigneeUserId: nextId },
        ...context,
      },
      transaction,
    );

    // Phase 4 (FR-042). Inside the transaction so the notification and the
    // assignment commit together; the service emits to the live stream only
    // after that commit, so nobody is ever told about an assignment that then
    // rolled back.
    //
    // Only on assignment, not on unassignment: "this is no longer yours" is not
    // news an agent needs pushed at them mid-task. A supervisor reassigning
    // work is visible in the queue, which is where it belongs.
    if (nextId !== null) {
      await notificationService.create(
        {
          userId: nextId,
          type: notificationService.NOTIFICATION_TYPES.TICKET_ASSIGNED,
          actorUserId: actor.id,
          ticketId: ticket.id,
        },
        transaction,
      );
    }

    // Phase 6 (FR-056). Assigned and unassigned are SEPARATE triggers, because
    // a rule reacting to work being taken away is a different rule from one
    // reacting to it arriving.
    automationEngine.emit(
      nextId === null
        ? { trigger: 'ticket.unassigned', ticketId: ticket.id, actorUserId: actor.id }
        : {
            trigger: 'ticket.assigned',
            ticketId: ticket.id,
            actorUserId: actor.id,
            assigneeUserId: nextId,
          },
      transaction,
    );
  });

  return getById(ticket.id);
}

// --- Merge ---------------------------------------------------------------

export interface MergeInput {
  intoTicketId?: unknown;
  version?: unknown;
  note?: unknown;
}

/**
 * Permanent and irreversible. There is no un-merge in this phase, which is part
 * of why `record.deleted` is the honest audit key for it (research.md D8).
 */
export async function merge(
  id: number,
  input: MergeInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<TicketDetail> {
  const ticket = await loadTicket(id);

  // Already merged: refused, naming the survivor it already resolves to.
  await lifecycleService.assertWorkable(ticket);
  assertVersion(ticket, input.version);

  const intoId = Number(input.intoTicketId);

  if (!Number.isInteger(intoId) || intoId < 1) {
    throw validationError([{ field: 'intoTicketId', message: 'ticket.error.mergeTargetRequired' }]);
  }

  if (intoId === ticket.id) {
    throw validationError([{ field: 'intoTicketId', message: 'ticket.error.mergeSelf' }]);
  }

  const target = await Ticket.findByPk(intoId);

  if (!target) {
    throw validationError([{ field: 'intoTicketId', message: 'ticket.error.mergeTargetNotFound' }]);
  }

  if (target.status === 'closed') {
    throw validationError([{ field: 'intoTicketId', message: 'ticket.error.mergeTargetClosed' }]);
  }

  // CYCLE GUARD. If the target already resolves back to this ticket, merging
  // would create a loop that no reader could follow out of.
  const targetSurvivorId = await lifecycleService.resolveSurvivorId(target);

  if (targetSurvivorId === ticket.id) {
    throw validationError([{ field: 'intoTicketId', message: 'ticket.error.mergeCycle' }]);
  }

  const note =
    typeof input.note === 'string' && input.note.trim() !== '' ? input.note.trim() : null;

  await sequelize.transaction(async (transaction) => {
    ticket.merged_into_ticket_id = target.id;
    await ticket.save({ transaction });

    // Phase 4 (FR-065). A follow-up someone committed to does not evaporate
    // because the ticket it hung on was absorbed — it moves to the survivor,
    // which is the ticket that is still workable. Done in the merge
    // transaction so a task can never be left pointing at a redirect.
    await taskService.repointToSurvivor(ticket.id, target.id, transaction);

    // Recorded against BOTH tickets. The absorbed ticket's history says where
    // it went; the survivor's says what it received. Neither row is moved —
    // the survivor's timeline SPANS the chain at read time (FR-041).
    await historyService.record(
      {
        ticketId: ticket.id,
        event: historyService.TICKET_EVENTS.MERGED,
        actor,
        field: 'mergedInto',
        previousValue: null,
        newValue: toReference(target.id),
        note,
      },
      transaction,
    );

    await historyService.record(
      {
        ticketId: target.id,
        event: historyService.TICKET_EVENTS.MERGE_RECEIVED,
        actor,
        field: 'mergedFrom',
        previousValue: null,
        newValue: toReference(ticket.id),
        note,
      },
      transaction,
    );

    // BOTH audit keys (FR-053). `record.deleted` is the security-relevant fact
    // — a record a user created is permanently out of active use — and
    // `ticket.merged` is the domain detail. This is the first caller
    // record.deleted has had since Phase 1 defined it.
    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.RECORD_DELETED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        metadata: { reason: 'merged', intoTicketId: target.id },
        ...context,
      },
      transaction,
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.TICKET_MERGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        newValue: { mergedIntoTicketId: target.id },
        metadata: note === null ? undefined : { note },
        ...context,
      },
      transaction,
    );
  });

  return getById(ticket.id);
}
