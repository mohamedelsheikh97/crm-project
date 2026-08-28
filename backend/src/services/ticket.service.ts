import { Op, literal, type WhereOptions } from 'sequelize';

import { sequelize } from '../config/database.js';
import {
  customerInactive,
  notFound,
  staleRecord,
  ticketClosed,
  validationError,
  type ErrorDetail,
} from '../errors/app-error.js';
import { Customer, Ticket, TicketLink, User } from '../models/index.js';
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

import * as auditService from './audit.service.js';
import * as authorizationService from './authorization.service.js';
import * as historyService from './ticket-history.service.js';
import * as lifecycleService from './ticket-lifecycle.service.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

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

  return {
    ...toSummary(ticket),
    description: ticket.description,
    escalationReason: ticket.escalation_reason,
    createdBy: ticket.createdBy
      ? { id: ticket.createdBy.id, fullName: ticket.createdBy.full_name }
      : null,
    links: await linksFor(ticket.id),
    survivor: survivorId === null ? null : { id: survivorId, reference: toReference(survivorId) },
  };
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

    return ticket;
  });

  return getById(created.id);
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
  });

  // Reopening RETAINS ALL HISTORY (FR-022) — nothing above deletes anything,
  // which is the whole implementation of that requirement.
  return getById(ticket.id);
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
