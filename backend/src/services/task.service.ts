import { Op, literal, type Transaction } from 'sequelize';

import { notFound, validationError } from '../errors/app-error.js';
import { now } from '../lib/clock.js';
import { Customer, Task, Ticket } from '../models/index.js';
import { toReference } from '../tickets/reference.js';
import type { Actor, Paged } from './ticket.service.js';
import { clampPageSize } from './ticket.service.js';

/**
 * Personal follow-up commitments (Clarifications Q3).
 *
 * THE ONE RULE THAT SHAPES THIS WHOLE FILE: a task belongs to the person who
 * created it and cannot be given to anyone else. `owner_user_id` comes from the
 * session and is never read from a request body — an ownership column the
 * client cannot influence is a stronger guarantee than a validation rule
 * somebody could later forget to apply.
 *
 * Delegation is not missing from this system; it is Phase 3 ticket assignment.
 * PLAN.md names one mechanism for directing work, and this is not it.
 */

export interface TaskView {
  id: number;
  title: string;
  dueAt: Date | null;
  remindAt: Date | null;
  isOverdue: boolean;
  completedAt: Date | null;
  ticket: { id: number; reference: string; subject: string } | null;
  customer: { id: number; displayName: string } | null;
  createdAt: Date;
}

type Loaded = Task & { ticket?: Ticket | null; customer?: Customer | null };

const VIEW_INCLUDE = [
  { model: Ticket, as: 'ticket' },
  { model: Customer, as: 'customer' },
];

function toView(task: Loaded, now: Date): TaskView {
  return {
    id: task.id,
    title: task.title,
    dueAt: task.due_at,
    remindAt: task.remind_at,
    // Against the server clock, like a ticket's (FR-020). A completed task is
    // never overdue — the commitment was kept, however late.
    isOverdue:
      task.completed_at === null && task.due_at !== null && task.due_at.getTime() < now.getTime(),
    completedAt: task.completed_at,
    ticket: task.ticket
      ? {
          id: task.ticket.id,
          reference: toReference(task.ticket.id),
          subject: task.ticket.subject,
        }
      : null,
    customer: task.customer
      ? { id: task.customer.id, displayName: task.customer.display_name }
      : null,
    createdAt: task.created_at,
  };
}

/** MySQL DATETIME is second-precision; truncate so stored and sent agree. */
function parseDate(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const parsed = new Date(String(value));

  if (Number.isNaN(parsed.getTime())) {
    throw validationError([{ field, message: 'task.error.dateInvalid' }]);
  }

  parsed.setMilliseconds(0);

  return parsed;
}

async function resolveLink(
  ticketId: unknown,
  customerId: unknown,
): Promise<{ ticketId: number | null; customerId: number | null }> {
  const ticket = ticketId === undefined || ticketId === null ? null : Number(ticketId);
  const customer = customerId === undefined || customerId === null ? null : Number(customerId);

  // FR-056, enforced here as well as by the CHECK constraint. A task is about
  // one thing; "call this customer about that ticket" is a task on the ticket.
  if (ticket !== null && customer !== null) {
    throw validationError([
      { field: 'ticketId', message: 'task.error.oneLinkOnly' },
      { field: 'customerId', message: 'task.error.oneLinkOnly' },
    ]);
  }

  if (ticket !== null) {
    if (!Number.isInteger(ticket) || !(await Ticket.findByPk(ticket))) {
      throw validationError([{ field: 'ticketId', message: 'task.error.ticketNotFound' }]);
    }

    return { ticketId: ticket, customerId: null };
  }

  if (customer !== null) {
    if (!Number.isInteger(customer) || !(await Customer.findByPk(customer))) {
      throw validationError([{ field: 'customerId', message: 'task.error.customerNotFound' }]);
    }

    return { ticketId: null, customerId: customer };
  }

  return { ticketId: null, customerId: null };
}

/**
 * Every read and write is scoped to the owner.
 *
 * 404 rather than 403 for someone else's task: whether a given task exists is
 * not the caller's business, and a 403 would confirm it. Verified for every
 * route by tests/ownership.matrix.test.ts.
 */
async function ownedTask(id: number, actor: Actor): Promise<Task> {
  const task = await Task.findOne({ where: { id, owner_user_id: actor.id } });

  if (!task) throw notFound();

  return task;
}

async function reload(id: number): Promise<TaskView> {
  const task = (await Task.findByPk(id, { include: VIEW_INCLUDE })) as Loaded | null;

  if (!task) throw notFound();

  return toView(task, new Date());
}

export interface ListOptions {
  status?: string;
  ticketId?: number;
  customerId?: number;
  page?: unknown;
  pageSize?: unknown;
}

export async function list(actor: Actor, options: ListOptions = {}): Promise<Paged<TaskView>> {
  const pageSize = clampPageSize(options.pageSize);
  const pageNumber = Number(options.page);
  const page = Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.floor(pageNumber) : 1;
  const now = new Date();

  const where: Record<string | symbol, unknown> = { owner_user_id: actor.id };

  // Outstanding by default — the dashboard asks "what do I still owe someone",
  // not "what have I ever owed anyone".
  if (options.status === 'completed') {
    where.completed_at = { [Op.ne]: null };
  } else if (options.status !== 'all') {
    where.completed_at = null;
  }

  if (options.ticketId !== undefined) where.ticket_id = options.ticketId;
  if (options.customerId !== undefined) where.customer_id = options.customerId;

  const { rows, count } = await Task.findAndCountAll({
    where,
    include: VIEW_INCLUDE,
    // Soonest-due first, with undated tasks grouped at the end — the same
    // ordering rule the ticket queue uses, for the same reason (FR-023).
    // `literal`, not a raw object: MySQL sorts NULL first ascending, so without
    // the leading expression an undated task would lead the list.
    order: [
      [literal('(`Task`.`due_at` IS NULL)'), 'ASC'],
      ['due_at', 'ASC'],
      ['id', 'DESC'],
    ] as never,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  return {
    items: (rows as Loaded[]).map((task) => toView(task, now)),
    page,
    pageSize,
    total: count,
  };
}

export interface TaskInput {
  title?: unknown;
  dueAt?: unknown;
  remindAt?: unknown;
  ticketId?: unknown;
  customerId?: unknown;
}

export async function create(input: TaskInput, actor: Actor): Promise<TaskView> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';

  if (title === '') {
    throw validationError([{ field: 'title', message: 'task.error.titleRequired' }]);
  }

  // An owner field in the body is REJECTED rather than ignored, so an attempt
  // to give someone a task fails loudly instead of silently becoming a task for
  // oneself (Clarifications Q3).
  if ('ownerUserId' in input || 'owner_user_id' in input) {
    throw validationError([{ field: 'ownerUserId', message: 'task.error.ownerNotSettable' }]);
  }

  const link = await resolveLink(input.ticketId, input.customerId);

  const task = await Task.create({
    owner_user_id: actor.id,
    title,
    due_at: parseDate(input.dueAt, 'dueAt'),
    remind_at: parseDate(input.remindAt, 'remindAt'),
    ticket_id: link.ticketId,
    customer_id: link.customerId,
  });

  return reload(task.id);
}

export async function update(id: number, input: TaskInput, actor: Actor): Promise<TaskView> {
  const task = await ownedTask(id, actor);

  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';

    if (title === '') {
      throw validationError([{ field: 'title', message: 'task.error.titleRequired' }]);
    }

    task.title = title;
  }

  if (input.dueAt !== undefined) {
    task.due_at = parseDate(input.dueAt, 'dueAt');
  }

  if (input.remindAt !== undefined) {
    const next = parseDate(input.remindAt, 'remindAt');
    const changed = next?.getTime() !== task.remind_at?.getTime();

    task.remind_at = next;

    // Changing the time RE-ARMS the reminder; clearing it cancels the pending
    // one (FR-062). Without this, moving a reminder that had already fired
    // would silently never fire again.
    if (changed) task.reminded_at = null;
  }

  if (input.ticketId !== undefined || input.customerId !== undefined) {
    const link = await resolveLink(
      input.ticketId ?? task.ticket_id,
      input.customerId ?? task.customer_id,
    );

    task.ticket_id = link.ticketId;
    task.customer_id = link.customerId;
  }

  await task.save();

  return reload(task.id);
}

export async function complete(id: number, actor: Actor): Promise<TaskView> {
  const task = await ownedTask(id, actor);

  if (task.completed_at === null) {
    // Recorded, not deleted (FR-059). The commitment stays part of the record.
    task.completed_at = now();
    await task.save();
  }

  return reload(task.id);
}

export async function reopen(id: number, actor: Actor): Promise<TaskView> {
  const task = await ownedTask(id, actor);

  if (task.completed_at !== null) {
    task.completed_at = null;
    await task.save();
  }

  return reload(task.id);
}

/**
 * Outstanding tasks on a ticket, for whoever is closing it (FR-064).
 *
 * Deliberately NOT scoped to one owner: closing a ticket with somebody else's
 * follow-up still open is exactly the situation worth surfacing. It reports and
 * never blocks — the close is not refused because a task is open.
 */
export async function outstandingForTicket(ticketId: number): Promise<TaskView[]> {
  const now = new Date();

  const tasks = (await Task.findAll({
    where: { ticket_id: ticketId, completed_at: null },
    include: VIEW_INCLUDE,
    order: [['id', 'ASC']],
  })) as Loaded[];

  return tasks.map((task) => toView(task, now));
}

/**
 * Repoints tasks at a merged ticket's survivor (FR-065).
 *
 * Called from the merge path inside its transaction. Without this a task
 * silently attaches to a redirect nobody can work.
 */
export async function repointToSurvivor(
  mergedTicketId: number,
  survivorTicketId: number,
  transaction: Transaction,
): Promise<void> {
  await Task.update(
    { ticket_id: survivorTicketId },
    { where: { ticket_id: mergedTicketId }, transaction },
  );
}
