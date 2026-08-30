import { Op, literal, type WhereOptions } from 'sequelize';

import { forbidden, notFound } from '../errors/app-error.js';
import { Customer, CustomerContact, CustomerNote, Ticket, User } from '../models/index.js';
import { toReference } from '../tickets/reference.js';
import type { TicketPriority } from '../tickets/taxonomy.js';
import { prioritySortExpression } from '../tickets/taxonomy.js';
import type { TicketStatus } from '../tickets/lifecycle.js';
import * as authorizationService from './authorization.service.js';
import { dueDateOrder, isOverdue } from './ticket-due.service.js';
import type { Actor, Paged } from './ticket.service.js';
import { clampPageSize } from './ticket.service.js';

/**
 * The agent's queue and the customer context panel.
 *
 * The queue is NOT a stored record. It is a filtered, sorted, bounded view over
 * Phase 3's tickets, defined as "assigned to this user" — and because Phase 3
 * fixed assignment as Supervisor-only (Clarifications Q3), an agent's queue
 * changes only when a supervisor changes it. There is deliberately no claim
 * action anywhere in this service.
 */

const MAX_CONTEXT_ITEMS = 5;

export interface QueueItem {
  id: number;
  reference: string;
  subject: string;
  customer: { id: number; displayName: string; isActive: boolean } | null;
  status: TicketStatus;
  priority: TicketPriority;
  dueAt: Date | null;
  /** Computed server-side against the server clock (FR-020) — never client-side. */
  isOverdue: boolean;
  /** How long it has been waiting (FR-002). */
  waitingSince: Date;
}

export interface QueuePage extends Paged<QueueItem> {
  viewingUser: { id: number; fullName: string };
}

export interface QueueOptions {
  userId?: number;
  status?: string[];
  priority?: string[];
  overdueOnly?: boolean;
  includeClosed?: boolean;
  sort?: string;
  direction?: string;
  page?: unknown;
  pageSize?: unknown;
}

const SORTABLE = new Set(['priority', 'status', 'age', 'dueAt']);

function clampPage(requested: unknown): number {
  const value = Number(requested);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

function orderFor(
  sort: string | undefined,
  direction: string | undefined,
): Array<[unknown, string]> {
  const dir = direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const field = sort && SORTABLE.has(sort) ? sort : 'priority';

  switch (field) {
    case 'priority':
      // By RANK, from tickets/taxonomy.ts — never a second hardcoded list here,
      // which would silently drift the moment a priority is added (FR-006).
      // Default direction is DESC so the most urgent leads, which is what an
      // agent opening their queue means by "sort by priority".
      return [
        [literal(prioritySortExpression()), direction ? dir : 'DESC'],
        ['id', 'DESC'],
      ];
    case 'dueAt':
      // NULLs pinned to one end in BOTH directions (FR-023).
      return dueDateOrder(dir) as Array<[unknown, string]>;
    case 'status':
      return [
        ['status', dir],
        ['id', 'DESC'],
      ];
    case 'age':
    default:
      // "Age" is how long it has been waiting, so ascending age means oldest
      // first — which is the inverse of created_at ascending. Inverting here
      // rather than in the interface keeps the label honest.
      return [
        ['created_at', dir === 'ASC' ? 'ASC' : 'DESC'],
        ['id', 'DESC'],
      ];
  }
}

/**
 * Resolves whose queue is being asked for, and whether the caller may see it.
 *
 * `dashboard:view` covers your own; `dashboard:view_any` is what lets a
 * Supervisor look at someone else's (FR-010). Naming yourself explicitly is
 * always allowed — it is the same request as omitting the parameter.
 */
async function resolveTarget(actor: Actor, requestedUserId: number | undefined): Promise<User> {
  if (requestedUserId === undefined || requestedUserId === actor.id) {
    const self = await User.findByPk(actor.id);
    if (!self) throw notFound();
    return self;
  }

  const allowed = await authorizationService.roleHasPermission(actor.roleId, 'dashboard:view_any');

  if (!allowed) throw forbidden();

  const target = await User.findByPk(requestedUserId);

  if (!target) throw notFound();

  return target;
}

export async function queue(actor: Actor, options: QueueOptions = {}): Promise<QueuePage> {
  const target = await resolveTarget(actor, options.userId);

  const pageSize = clampPageSize(options.pageSize);
  const page = clampPage(options.page);
  const now = new Date();

  const where: WhereOptions & Record<string | symbol, unknown> = {
    assignee_user_id: target.id,
    // A merged ticket is a redirect. A queue full of redirects is not a queue
    // (FR-004).
    merged_into_ticket_id: null,
  };

  if (options.status?.length) {
    where.status = options.status;
  } else if (!options.includeClosed) {
    // Closed is excluded by default but reachable deliberately (FR-003). An
    // explicit status filter wins, so asking for closed tickets works without
    // also passing includeClosed.
    where.status = { [Op.ne]: 'closed' };
  }

  if (options.priority?.length) where.priority = options.priority;

  if (options.overdueOnly) {
    where.due_at = { [Op.ne]: null, [Op.lt]: now };
    // Overdue never includes Closed, whatever the status filter says (FR-027).
    where.status = { [Op.ne]: 'closed' };
  }

  const { rows, count } = await Ticket.findAndCountAll({
    where,
    include: [{ model: Customer, as: 'customer' }],
    order: orderFor(options.sort, options.direction) as never,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  return {
    items: rows.map((row) => {
      const ticket = row as Ticket & { customer?: Customer };

      return {
        id: ticket.id,
        reference: toReference(ticket.id),
        subject: ticket.subject,
        customer: ticket.customer
          ? {
              id: ticket.customer.id,
              displayName: ticket.customer.display_name,
              isActive: ticket.customer.is_active,
            }
          : null,
        status: ticket.status,
        priority: ticket.priority,
        dueAt: ticket.due_at,
        isOverdue: isOverdue(ticket, now),
        waitingSince: ticket.created_at,
      };
    }),
    page,
    pageSize,
    total: count,
    viewingUser: { id: target.id, fullName: target.full_name },
  };
}

// --- Customer context panel ----------------------------------------------

export interface CustomerContext {
  customer: {
    id: number;
    displayName: string;
    company: string | null;
    isActive: boolean;
    contacts: Array<{ id: number; kind: string; value: string; isPrimary: boolean }>;
  };
  otherTickets: Array<{
    id: number;
    reference: string;
    subject: string;
    status: TicketStatus;
    priority: TicketPriority;
  }>;
  recentNotes: Array<{
    id: number;
    body: string;
    author: { id: number; fullName: string } | null;
    createdAt: Date;
  }>;
}

/**
 * Everything the context panel needs, in ONE request.
 *
 * Three round-trips would make "without navigating away" — PLAN.md's Definition
 * of done — feel like navigating away, which is the thing this phase exists to
 * fix. The panel is one region of one screen, so it is one call.
 *
 * Route-gated on `customers:view` in addition to `tickets:view`. A caller
 * without it gets no panel and loses nothing else: the ticket stays fully
 * workable (FR-018).
 */
export async function customerContext(ticketId: number): Promise<CustomerContext> {
  const ticket = await Ticket.findByPk(ticketId);

  if (!ticket) throw notFound();

  const customer = (await Customer.findByPk(ticket.customer_id, {
    include: [{ model: CustomerContact, as: 'contacts' }],
  })) as (Customer & { contacts?: CustomerContact[] }) | null;

  if (!customer) throw notFound();

  const [otherTickets, recentNotes] = await Promise.all([
    Ticket.findAll({
      where: {
        customer_id: customer.id,
        id: { [Op.ne]: ticket.id },
        merged_into_ticket_id: null,
      },
      order: [['updated_at', 'DESC']],
      limit: MAX_CONTEXT_ITEMS,
    }),
    CustomerNote.findAll({
      where: { customer_id: customer.id },
      include: [{ model: User, as: 'author' }],
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: MAX_CONTEXT_ITEMS,
    }),
  ]);

  return {
    customer: {
      id: customer.id,
      displayName: customer.display_name,
      company: customer.company,
      // Reported, never a blocker: a deactivated customer's ticket stays
      // workable (FR-016).
      isActive: customer.is_active,
      contacts: (customer.contacts ?? []).map((contact) => ({
        id: contact.id,
        kind: contact.kind,
        // The raw value, as the customer gave it. `value_normalised` exists for
        // duplicate matching, not for display — showing a normalised phone
        // number back to an agent reading it aloud would be actively unhelpful.
        value: contact.value_raw,
        isPrimary: contact.is_primary,
      })),
    },
    otherTickets: otherTickets.map((other) => ({
      id: other.id,
      reference: toReference(other.id),
      subject: other.subject,
      status: other.status,
      priority: other.priority,
    })),
    recentNotes: recentNotes.map((note) => {
      const loaded = note as CustomerNote & { author?: User | null };

      return {
        id: loaded.id,
        body: loaded.body,
        author: loaded.author ? { id: loaded.author.id, fullName: loaded.author.full_name } : null,
        createdAt: loaded.created_at,
      };
    }),
  };
}
