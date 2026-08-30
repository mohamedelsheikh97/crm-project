import type { Transaction } from 'sequelize';

import { Ticket, TicketHistory } from '../models/index.js';

import { redact } from './audit.service.js';

/**
 * The per-ticket history writer and reader.
 *
 * SEPARATE FROM THE AUDIT LOG on purpose (research.md D2). This is read by
 * anyone who may view the ticket (FR-037); the audit log is audit:view only.
 * FR-052 requires BOTH, so every state change writes to both stores inside one
 * transaction — a status that changed without its history entry, or an entry
 * for a status that did not change, is not a state this system can reach.
 *
 * APPEND-ONLY: this module exports no update and no delete, and none may be
 * added (FR-034).
 */

export const TICKET_EVENTS = {
  CREATED: 'ticket.created',
  UPDATED: 'ticket.updated',
  STATUS_CHANGED: 'ticket.status.changed',
  ASSIGNED: 'ticket.assigned',
  UNASSIGNED: 'ticket.unassigned',
  ESCALATED: 'ticket.escalated',
  DEESCALATED: 'ticket.deescalated',
  CLOSED: 'ticket.closed',
  REOPENED: 'ticket.reopened',
  MERGED: 'ticket.merged',
  MERGE_RECEIVED: 'ticket.merge.received',
  LINKED: 'ticket.linked',
  UNLINKED: 'ticket.unlinked',

  // Phase 4. A due date is a field like any other, so its changes belong in the
  // history with previous and new value (FR-022). Three events rather than one
  // because "someone put a date on this" and "someone took the date off" read
  // differently to the person catching up on the ticket.
  DUE_DATE_SET: 'ticket.due_date.set',
  DUE_DATE_CHANGED: 'ticket.due_date.changed',
  DUE_DATE_CLEARED: 'ticket.due_date.cleared',

  // Records THAT a note happened, never its body (FR-078). The history stays a
  // change log; it does not become a second copy of the conversation.
  NOTE_ADDED: 'ticket.note.added',
} as const;

export type TicketEvent = (typeof TICKET_EVENTS)[keyof typeof TICKET_EVENTS];

export interface HistoryActor {
  id: number;
  fullName: string;
}

export interface HistoryEntryInput {
  ticketId: number;
  event: TicketEvent;
  actor: HistoryActor;
  field?: string | null;
  previousValue?: string | null;
  newValue?: string | null;
  note?: string | null;
}

/**
 * `note` is free text, so it gets the same deny-list redaction every audit JSON
 * field gets (FR-039). The other columns hold domain values, but a careless
 * caller must not be able to leak a credential through a note either.
 */
function scrub(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const redacted = redact({ value }) as { value: unknown };
  return typeof redacted.value === 'string' ? redacted.value : String(redacted.value);
}

/**
 * REQUIRES a transaction — it shares the transaction of the change it records,
 * so "it happened but was not recorded" is unrepresentable. Same contract as
 * auditService.record.
 */
export async function record(entry: HistoryEntryInput, transaction: Transaction): Promise<void> {
  await TicketHistory.create(
    {
      ticket_id: entry.ticketId,
      event: entry.event,
      actor_user_id: entry.actor.id,
      // Snapshotted, so the entry stays attributed once the actor is
      // deactivated (FR-038).
      actor_name: entry.actor.fullName,
      field: entry.field ?? null,
      previous_value: scrub(entry.previousValue),
      new_value: scrub(entry.newValue),
      note: scrub(entry.note),
    },
    { transaction },
  );
}

/** Several entries for one change — an edit touching three fields writes three. */
export async function recordAll(
  entries: HistoryEntryInput[],
  transaction: Transaction,
): Promise<void> {
  for (const entry of entries) {
    await record(entry, transaction);
  }
}

export interface HistoryEntryView {
  id: number;
  event: string;
  actorName: string;
  field: string | null;
  previousValue: string | null;
  newValue: string | null;
  note: string | null;
  createdAt: Date;
  /** Which ticket this happened to, so a spanning history stays readable. */
  ticketId: number;
}

/**
 * Every ticket whose history belongs on this one's timeline: itself plus every
 * ticket merged into it, transitively.
 *
 * The history SPANS the chain rather than being rewritten onto the survivor
 * (FR-041). Rewriting ticket_id would have been simpler and would have
 * destroyed the provenance the history exists to preserve.
 *
 * Breadth-first with a seen-set, so a cycle that somehow reached the database
 * terminates here rather than hanging the request.
 */
export async function absorbedTicketIds(ticketId: number): Promise<number[]> {
  const collected = new Set<number>([ticketId]);
  let frontier = [ticketId];

  while (frontier.length > 0) {
    const rows = await Ticket.findAll({
      where: { merged_into_ticket_id: frontier },
      attributes: ['id'],
    });

    frontier = rows.map((row) => row.id).filter((id) => !collected.has(id));
    for (const id of frontier) collected.add(id);
  }

  return [...collected];
}

export interface HistoryPage {
  items: HistoryEntryView[];
  page: number;
  pageSize: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function list(
  ticketId: number,
  options: { page?: unknown; pageSize?: unknown } = {},
): Promise<HistoryPage> {
  const requestedSize = Number(options.pageSize);
  const pageSize =
    Number.isFinite(requestedSize) && requestedSize >= 1
      ? Math.min(Math.floor(requestedSize), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const requestedPage = Number(options.page);
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;

  const ticketIds = await absorbedTicketIds(ticketId);

  const { rows, count } = await TicketHistory.findAndCountAll({
    where: { ticket_id: ticketIds },
    // OLDEST FIRST (FR-035) — the opposite of the audit log and of customer
    // notes, and deliberately so: those are scanned for the latest event, this
    // is read from the beginning to understand what happened.
    //
    // `id` is the tiebreaker because MySQL DATETIME is second-precision and
    // several events routinely land in the same second.
    order: [
      ['created_at', 'ASC'],
      ['id', 'ASC'],
    ],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      event: row.event,
      actorName: row.actor_name,
      field: row.field,
      previousValue: row.previous_value,
      newValue: row.new_value,
      note: row.note,
      createdAt: row.created_at,
      ticketId: row.ticket_id,
    })),
    page,
    pageSize,
    total: count,
  };
}
