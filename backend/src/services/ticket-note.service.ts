import { Op, type Transaction } from 'sequelize';

import { sequelize } from '../config/database.js';
import {
  forbidden,
  mentionLimit,
  mentionNotVisible,
  notFound,
  validationError,
} from '../errors/app-error.js';
import { Ticket, TicketNote, TicketNoteMention, User } from '../models/index.js';
import { now } from '../lib/clock.js';
import * as authorizationService from './authorization.service.js';
import * as historyService from './ticket-history.service.js';
import * as notificationService from './notification.service.js';
import type { UserActor as Actor, Paged } from './ticket.service.js';
import { clampPageSize } from './ticket.service.js';

/**
 * Internal notes and the mentions inside them.
 *
 * The distinction from ticket_history is worth keeping in mind while reading
 * this file: history records WHAT CHANGED, a note records what a person wants
 * the next person to know. A note therefore writes a history entry saying THAT
 * it happened (FR-078), and never copies its body there — the history stays a
 * change log rather than becoming a second copy of the conversation.
 */

/**
 * The mention token stored in a note body.
 *
 * A token, not a display name: a stored name goes stale on rename and
 * misattributes after deactivation, which would break FR-035 and FR-041. The
 * client renders the current name from the note's `mentions` array.
 */
const MENTION_PATTERN = /@\[user:(\d+)\]/g;

/** Bounded per note (FR-038). Twenty people on one note is a meeting, not a note. */
export const MAX_MENTIONS_PER_NOTE = 10;

const MAX_MENTIONABLE_RESULTS = 20;

export interface MentionView {
  id: number;
  fullName: string;
  isActive: boolean;
}

export interface TicketNoteView {
  id: number;
  ticketId: number;
  body: string;
  author: { id: number; fullName: string; isActive: boolean } | null;
  mentions: MentionView[];
  editedAt: Date | null;
  createdAt: Date;
}

type Loaded = TicketNote & {
  author?: User | null;
  mentions?: Array<TicketNoteMention & { user?: User | null }>;
};

function toView(note: Loaded): TicketNoteView {
  return {
    id: note.id,
    ticketId: note.ticket_id,
    body: note.body,
    author: note.author
      ? { id: note.author.id, fullName: note.author.full_name, isActive: note.author.is_active }
      : null,
    mentions: (note.mentions ?? [])
      .map((mention) =>
        mention.user
          ? {
              id: mention.user.id,
              fullName: mention.user.full_name,
              // Surfaced rather than filtered: a mentioned user who has since
              // been deactivated must still render, marked, so the note keeps
              // its meaning (FR-035).
              isActive: mention.user.is_active,
            }
          : null,
      )
      .filter((mention): mention is MentionView => mention !== null),
    editedAt: note.edited_at,
    createdAt: note.created_at,
  };
}

const VIEW_INCLUDE = [
  { model: User, as: 'author' },
  { model: TicketNoteMention, as: 'mentions', include: [{ model: User, as: 'user' }] },
];

/** Distinct user ids named in a body, in the order they first appear. */
function parseMentionIds(body: string): number[] {
  const ids: number[] = [];

  for (const match of body.matchAll(MENTION_PATTERN)) {
    const id = Number(match[1]);
    // Deduplicated here as well as by the UNIQUE constraint, so the limit in
    // FR-038 counts PEOPLE rather than occurrences — naming one colleague three
    // times in a long note is not three mentions.
    if (Number.isInteger(id) && id >= 1 && !ids.includes(id)) ids.push(id);
  }

  return ids;
}

/**
 * Resolves mention ids to users who may actually open the ticket.
 *
 * Refusing at composition time is the point of FR-037. The alternative —
 * accepting the note and silently dropping the notification — leaves the author
 * believing they asked someone for help who was never told.
 */
async function resolveMentions(ids: number[], authorId: number): Promise<User[]> {
  if (ids.length === 0) return [];

  if (ids.length > MAX_MENTIONS_PER_NOTE) {
    throw mentionLimit(MAX_MENTIONS_PER_NOTE);
  }

  const users = await User.findAll({ where: { id: ids } });
  const found = new Map(users.map((user) => [user.id, user]));

  const rejected: MentionView[] = [];
  const accepted: User[] = [];

  for (const id of ids) {
    const user = found.get(id);

    // Mentioning yourself is allowed in the text — it just produces no
    // notification (FR-040). Rejecting it would be pedantry.
    if (user && user.id === authorId) {
      accepted.push(user);
      continue;
    }

    if (!user || !user.is_active) {
      rejected.push({ id, fullName: user?.full_name ?? String(id), isActive: false });
      continue;
    }

    if (!(await authorizationService.roleHasPermission(user.role_id, 'tickets:view'))) {
      rejected.push({ id: user.id, fullName: user.full_name, isActive: true });
      continue;
    }

    accepted.push(user);
  }

  if (rejected.length > 0) {
    throw mentionNotVisible(rejected);
  }

  return accepted;
}

async function loadTicket(ticketId: number): Promise<Ticket> {
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) throw notFound();
  return ticket;
}

async function reload(noteId: number): Promise<TicketNoteView> {
  const note = (await TicketNote.findByPk(noteId, { include: VIEW_INCLUDE })) as Loaded | null;
  if (!note) throw notFound();
  return toView(note);
}

export interface ListOptions {
  page?: unknown;
  pageSize?: unknown;
}

/**
 * Oldest first (FR-085 and the same reasoning Phase 3 applied to history): a
 * ticket's conversation reads as a story, not as a stack.
 */
export async function list(
  ticketId: number,
  options: ListOptions = {},
): Promise<Paged<TicketNoteView>> {
  await loadTicket(ticketId);

  const pageSize = clampPageSize(options.pageSize);
  const pageNumber = Number(options.page);
  const page = Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.floor(pageNumber) : 1;

  const { rows, count } = await TicketNote.findAndCountAll({
    where: { ticket_id: ticketId },
    include: VIEW_INCLUDE,
    order: [
      ['created_at', 'ASC'],
      ['id', 'ASC'],
    ],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  return {
    items: (rows as Loaded[]).map(toView),
    page,
    pageSize,
    total: count,
  };
}

async function writeMentions(
  noteId: number,
  ticketId: number,
  mentioned: User[],
  actor: Actor,
  transaction: Transaction,
): Promise<void> {
  for (const user of mentioned) {
    await TicketNoteMention.create({ note_id: noteId, user_id: user.id }, { transaction });

    // create() suppresses self-notification itself (FR-040), so no check here.
    await notificationService.create(
      {
        userId: user.id,
        type: notificationService.NOTIFICATION_TYPES.NOTE_MENTIONED,
        actorUserId: actor.id,
        ticketId,
        noteId,
      },
      transaction,
    );
  }
}

export async function create(
  ticketId: number,
  body: unknown,
  actor: Actor,
): Promise<TicketNoteView> {
  const ticket = await loadTicket(ticketId);

  const text = typeof body === 'string' ? body.trim() : '';

  if (text === '') {
    throw validationError([{ field: 'body', message: 'ticketNote.error.bodyRequired' }]);
  }

  const mentioned = await resolveMentions(parseMentionIds(text), actor.id);

  const note = await sequelize.transaction(async (transaction) => {
    const created = await TicketNote.create(
      { ticket_id: ticket.id, author_user_id: actor.id, body: text },
      { transaction },
    );

    await writeMentions(created.id, ticket.id, mentioned, actor, transaction);

    // THAT it happened, never the body (FR-078). Someone reading the history to
    // find out what has been tried should be told a conversation exists and go
    // read it, not be handed a second copy of it interleaved with field
    // changes.
    await historyService.record(
      {
        ticketId: ticket.id,
        event: historyService.TICKET_EVENTS.NOTE_ADDED,
        actor,
      },
      transaction,
    );

    return created;
  });

  return reload(note.id);
}

/**
 * Editing a note.
 *
 * An author may always edit their own; another user's needs
 * `ticket_notes:manage` (FR-034). That condition is why the permission matrix
 * cannot probe this route and defers to this file's tests instead.
 */
export async function update(
  ticketId: number,
  noteId: number,
  body: unknown,
  actor: Actor,
): Promise<TicketNoteView> {
  const note = await TicketNote.findOne({ where: { id: noteId, ticket_id: ticketId } });

  if (!note) throw notFound();

  if (note.author_user_id !== actor.id) {
    const allowed = await authorizationService.roleHasPermission(
      actor.roleId,
      'ticket_notes:manage',
    );

    if (!allowed) throw forbidden();
  }

  const text = typeof body === 'string' ? body.trim() : '';

  if (text === '') {
    throw validationError([{ field: 'body', message: 'ticketNote.error.bodyRequired' }]);
  }

  if (text === note.body) {
    return reload(note.id);
  }

  const mentioned = await resolveMentions(parseMentionIds(text), actor.id);
  const alreadyMentioned = await TicketNoteMention.findAll({ where: { note_id: note.id } });
  const existing = new Set(alreadyMentioned.map((mention) => mention.user_id));

  await sequelize.transaction(async (transaction) => {
    note.body = text;
    // Deliberately distinct from updated_at: this means "a human changed what
    // this says" (FR-033). A silently rewritten note is worse than no note.
    note.edited_at = now();
    await note.save({ transaction });

    // Only NEWLY named people are notified. Re-notifying everyone because the
    // author fixed a typo would train agents to ignore mentions.
    await writeMentions(
      note.id,
      ticketId,
      mentioned.filter((user) => !existing.has(user.id)),
      actor,
      transaction,
    );
  });

  return reload(note.id);
}

/**
 * Users who may be mentioned on this ticket.
 *
 * Filtered to those who CAN VIEW IT, so the picker can never offer someone the
 * note would then be refused for (FR-036 with FR-037). An interface that offers
 * a choice its own save will reject is worse than one that offers less.
 */
export async function mentionableUsers(ticketId: number, query: unknown): Promise<MentionView[]> {
  await loadTicket(ticketId);

  const term = typeof query === 'string' ? query.trim() : '';

  const users = await User.findAll({
    where: {
      is_active: true,
      ...(term === ''
        ? {}
        : {
            [Op.or]: [
              { full_name: { [Op.like]: `%${term}%` } },
              { email: { [Op.like]: `%${term}%` } },
            ],
          }),
    },
    order: [['full_name', 'ASC']],
    limit: MAX_MENTIONABLE_RESULTS,
  });

  const visible: MentionView[] = [];

  for (const user of users) {
    if (await authorizationService.roleHasPermission(user.role_id, 'tickets:view')) {
      visible.push({ id: user.id, fullName: user.full_name, isActive: true });
    }
  }

  return visible;
}
