import { Op } from 'sequelize';

import { Message, Ticket } from '../models/index.js';
import type { Channel } from '../models/message.model.js';
import { toReference } from '../tickets/reference.js';

import * as authorizationService from './authorization.service.js';

/**
 * ONE CUSTOMER, ONE CONVERSATION (FR-087-FR-093, SC-007).
 *
 * CORRESPONDENCE ONLY (Clarifications Q3, FR-087a). This service reads
 * `messages` and nothing else — no `ticket_notes`, no `ticket_history`. That is
 * not a layout preference: it means the structure Phase 8 will build a
 * customer-facing view on contains nothing internal to leak. A later phase that
 * adds notes or history here destroys that property, and it will not be obvious
 * that it has.
 *
 * NO customer_id ON MESSAGES. A message's customer is its ticket's customer, so
 * this joins through `tickets` on the index Phase 3 already has. A denormalised
 * copy would be a second place for the truth to live, which FR-019's customer
 * merge would then have to keep in step.
 */

export interface TimelineEntry {
  id: number;
  channel: Channel;
  direction: 'inbound' | 'outbound';
  occurredAt: Date;
  /** A short excerpt. The full body is on the ticket. */
  preview: string;
  ticket: { id: number; reference: string; subject: string };
}

export interface TimelinePage {
  items: TimelineEntry[];
  page: number;
  pageSize: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const PREVIEW_LENGTH = 160;

function preview(body: string): string {
  const flattened = body.replace(/\s+/g, ' ').trim();
  return flattened.length <= PREVIEW_LENGTH
    ? flattened
    : `${flattened.slice(0, PREVIEW_LENGTH - 1)}…`;
}

/**
 * Which of this customer's tickets the caller may see (FR-090).
 *
 * Phase 3 grants `tickets:view` to every role, and `tickets:manage_any` is
 * about acting rather than reading — so in this phase every authenticated
 * viewer who may see the customer may see their tickets. The filter is applied
 * anyway, and applied HERE rather than after loading, so that when a later
 * phase narrows ticket visibility this service narrows with it instead of
 * quietly disclosing.
 */
async function visibleTicketIds(customerId: number, roleId: number): Promise<number[]> {
  const tickets = await Ticket.findAll({
    where: { customer_id: customerId },
    attributes: ['id'],
  });

  if (tickets.length === 0) return [];

  const mayView = await authorizationService.roleHasPermission(roleId, 'tickets:view');

  return mayView ? tickets.map((ticket) => ticket.id) : [];
}

export interface TimelineViewer {
  roleId: number;
}

export async function forCustomer(
  customerId: number,
  viewer: TimelineViewer,
  options: { page?: unknown; pageSize?: unknown } = {},
): Promise<TimelinePage> {
  const pageSize = Math.min(
    Math.max(Math.floor(Number(options.pageSize) || DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const page = Math.max(Math.floor(Number(options.page) || 1), 1);

  const ticketIds = await visibleTicketIds(customerId, viewer.roleId);

  // `total` counts only what the caller may see. A count that included hidden
  // tickets would leak their existence through arithmetic.
  if (ticketIds.length === 0) {
    return { items: [], page, pageSize, total: 0 };
  }

  const { rows, count } = await Message.findAndCountAll({
    where: { ticket_id: { [Op.in]: ticketIds } },
    include: [{ model: Ticket, as: 'ticket', attributes: ['id', 'subject'] }],
    // BY WHEN IT HAPPENED, not by when we recorded it (FR-092). These diverge
    // whenever a poller catches up or a provider redelivers late, and a
    // customer's message belongs where they sent it.
    order: [
      ['occurred_at', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  const items = rows.map((row) => {
    const ticket = (row as Message & { ticket?: Ticket }).ticket;

    return {
      id: row.id,
      channel: row.channel,
      direction: row.direction,
      occurredAt: row.occurred_at,
      preview: preview(row.body),
      ticket: {
        id: row.ticket_id,
        reference: toReference(row.ticket_id),
        subject: ticket?.subject ?? '',
      },
    };
  });

  return { items, page, pageSize, total: count };
}

/**
 * Whether this customer has ANY correspondence at all, regardless of who may
 * see it.
 *
 * Distinguishes the two empty states the interface must tell apart: a customer
 * who has never corresponded, and one whose correspondence is all on tickets
 * this viewer cannot open. Phase 4 established that an unexplained empty area
 * is a defect.
 */
export async function hasAnyCorrespondence(customerId: number): Promise<boolean> {
  const found = await Message.findOne({
    include: [{ model: Ticket, as: 'ticket', attributes: [], where: { customer_id: customerId } }],
    attributes: ['id'],
  });

  return found !== null;
}
