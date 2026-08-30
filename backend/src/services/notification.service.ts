import { Op, type Transaction } from 'sequelize';

import { notFound } from '../errors/app-error.js';
import { now } from '../lib/clock.js';
import { Notification, Task, Ticket, User } from '../models/index.js';
import { NOTIFICATION_TYPES, type NotificationType } from '../models/notification.model.js';
import * as hub from '../lib/notification-hub.js';
import { toReference } from '../tickets/reference.js';
import { resolveSurvivorId } from './ticket-lifecycle.service.js';
import { clampPageSize } from './ticket.service.js';

/**
 * Notifications: the first thing in this project that reaches a user who did
 * not ask for it.
 *
 * THE GOVERNING RULE: a notification is a ROW FIRST, AN EVENT SECOND. Every
 * producer writes inside its own transaction and only then hands the saved row
 * to the hub. Nothing emits without persisting.
 *
 * That single ordering is what makes FR-047 and SC-009 true, and it is why
 * losing the stream costs latency and never a notification — which in turn is
 * why the client's reconnection logic can be as simple as "back off, reconnect,
 * ask for anything newer than the last id I saw".
 */

export { NOTIFICATION_TYPES, type NotificationType };

export const MAX_PAGE_SIZE = 50;

export interface NotificationView {
  id: number;
  type: NotificationType;
  actor: { id: number; fullName: string } | null;
  ticket: { id: number; reference: string; subject: string } | null;
  task: { id: number; title: string } | null;
  noteId: number | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  /** The recipient. */
  userId: number;
  type: NotificationType;
  /** Who caused it. Null for system-generated events — nobody caused them. */
  actorUserId?: number | null;
  ticketId?: number | null;
  taskId?: number | null;
  noteId?: number | null;
}

type Loaded = Notification & {
  actor?: User | null;
  ticket?: Ticket | null;
  task?: Task | null;
};

/**
 * Serialises a notification for the wire.
 *
 * NO MESSAGE IS PRODUCED HERE, and none is to be added. The client composes the
 * sentence from `notification.type.*` keys in ar.json / en.json using the actor
 * name and ticket reference as parameters. The same row may be read by an
 * Arabic user and an English one, so the language cannot be decided at write
 * time — and Principle I forbids a hardcoded string regardless.
 *
 * `survivorId` is threaded in rather than resolved here so that the merge-chain
 * walk (which touches the database) happens once per page instead of once per
 * row.
 */
function toView(notification: Loaded, survivorId?: number): NotificationView {
  const ticketId = survivorId ?? notification.ticket_id;

  return {
    id: notification.id,
    type: notification.type,
    actor: notification.actor
      ? { id: notification.actor.id, fullName: notification.actor.full_name }
      : null,
    ticket:
      notification.ticket && ticketId !== null
        ? {
            id: ticketId,
            reference: toReference(ticketId),
            subject: notification.ticket.subject,
          }
        : null,
    task: notification.task ? { id: notification.task.id, title: notification.task.title } : null,
    noteId: notification.note_id,
    readAt: notification.read_at,
    createdAt: notification.created_at,
  };
}

const VIEW_INCLUDE = [
  { model: User, as: 'actor' },
  { model: Ticket, as: 'ticket' },
  { model: Task, as: 'task' },
];

/**
 * Resolves any merged ticket subjects to their survivors (FR-052).
 *
 * At READ time, deliberately. Storing the survivor when the notification is
 * written would be wrong, because the merge usually has not happened yet — a
 * notification about a ticket merged away a week later must still lead
 * somewhere useful.
 */
async function survivorMap(notifications: Loaded[]): Promise<Map<number, number>> {
  const merged = notifications
    .map((notification) => notification.ticket)
    .filter((ticket): ticket is Ticket => !!ticket && ticket.merged_into_ticket_id !== null);

  const resolved = new Map<number, number>();

  for (const ticket of merged) {
    if (resolved.has(ticket.id)) continue;
    resolved.set(ticket.id, await resolveSurvivorId(ticket));
  }

  return resolved;
}

/**
 * Persist a notification, and emit it once the caller's transaction commits.
 *
 * The `transaction.afterCommit` hook is the mechanism that enforces the
 * ordering rule at the top of this file. Emitting inline would publish
 * notifications for work that later rolled back.
 */
export async function create(
  input: CreateNotificationInput,
  transaction: Transaction,
): Promise<Notification | null> {
  // FR-053 / FR-040: nobody is notified of their own action, including a
  // self-mention. Checked HERE rather than at each producer, so no future
  // producer can forget it.
  if (input.actorUserId !== null && input.actorUserId === input.userId) {
    return null;
  }

  const notification = await Notification.create(
    {
      user_id: input.userId,
      type: input.type,
      actor_user_id: input.actorUserId ?? null,
      ticket_id: input.ticketId ?? null,
      task_id: input.taskId ?? null,
      note_id: input.noteId ?? null,
    },
    { transaction },
  );

  transaction.afterCommit(async () => {
    // Reloaded with its associations so the stream and the list endpoint emit
    // the identical shape — a client must not have to handle two.
    const loaded = (await Notification.findByPk(notification.id, {
      include: VIEW_INCLUDE,
    })) as Loaded | null;

    if (!loaded) return;

    const survivors = await survivorMap([loaded]);

    hub.publish(input.userId, toView(loaded, survivors.get(loaded.ticket_id ?? -1)) as never);
  });

  return notification;
}

export interface ListOptions {
  unreadOnly?: boolean;
  /** Everything newer than this id — the client's catch-up after a reconnect. */
  since?: number;
  page?: unknown;
  pageSize?: unknown;
}

export interface NotificationPage {
  items: NotificationView[];
  page: number;
  pageSize: number;
  total: number;
  /** Rides along on every page so the badge never needs a second request. */
  unreadCount: number;
}

export async function list(userId: number, options: ListOptions = {}): Promise<NotificationPage> {
  const pageSize = Math.min(clampPageSize(options.pageSize), MAX_PAGE_SIZE);
  const pageNumber = Number(options.page);
  const page = Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.floor(pageNumber) : 1;

  // Scoped to the recipient, always. This is the ownership control the
  // permission model deliberately does not express (research D6) — two agents
  // hold identical permissions and still cannot read each other's.
  const where: Record<string | symbol, unknown> = { user_id: userId };

  if (options.unreadOnly) where.read_at = null;
  if (options.since !== undefined) where.id = { [Op.gt]: options.since };

  const { rows, count } = await Notification.findAndCountAll({
    where,
    include: VIEW_INCLUDE,
    order: [['id', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  const loaded = rows as Loaded[];
  const survivors = await survivorMap(loaded);

  return {
    items: loaded.map((row) => toView(row, survivors.get(row.ticket_id ?? -1))),
    page,
    pageSize,
    total: count,
    unreadCount: await unreadCount(userId),
  };
}

export async function unreadCount(userId: number): Promise<number> {
  return Notification.count({ where: { user_id: userId, read_at: null } });
}

/**
 * 404 rather than 403 for someone else's notification.
 *
 * Whether a given notification exists is itself not the caller's business, and
 * a 403 would confirm it. The cost of avoiding that leak is zero.
 */
export async function markRead(userId: number, id: number): Promise<NotificationView> {
  const notification = (await Notification.findOne({
    where: { id, user_id: userId },
    include: VIEW_INCLUDE,
  })) as Loaded | null;

  if (!notification) throw notFound();

  if (notification.read_at === null) {
    notification.read_at = now();
    await notification.save();
  }

  const survivors = await survivorMap([notification]);

  return toView(notification, survivors.get(notification.ticket_id ?? -1));
}

export async function markAllRead(userId: number): Promise<{ unreadCount: number }> {
  await Notification.update({ read_at: now() }, { where: { user_id: userId, read_at: null } });

  return { unreadCount: 0 };
}
