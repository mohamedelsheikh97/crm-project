import type { NextFunction, Request, Response } from 'express';

import { parseKeyset, toPage } from '../../api/paging.js';
import { handled, notFound } from '../../api/v1/errors.js';
import * as presenter from '../../api/v1/presenters/ticket.presenter.js';
import * as messageService from '../../services/message.service.js';
import * as ticketService from '../../services/ticket.service.js';
import { isTicketCategory, isTicketPriority } from '../../tickets/taxonomy.js';
import { isTicketStatus } from '../../tickets/lifecycle.js';

/**
 * Published ticket endpoints (Phase 11, US1).
 *
 * MAY NOT IMPORT A MODEL — asserted by
 * `backend/tests/api/no-rule-restatement.test.ts`.
 *
 * THE FILTER VALUES ARE VALIDATED AGAINST THE OWNING MODULES, not against a
 * list written here. `tickets/taxonomy.ts` owns categories and priorities and
 * `tickets/lifecycle.ts` owns statuses, so a fifth category added later is
 * accepted by this endpoint without anybody editing it — and, more to the point,
 * a value this endpoint accepted that the taxonomy did not would be a filter
 * matching nothing while looking like it worked.
 *
 * Phase 10 recorded the same discipline for its report filters. It is the same
 * failure both times: a hardcoded list that silently omits a value.
 */

/** A repeatable query parameter, as one or many. */
function asList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');

  return [];
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const keyset = parseKeyset(req.query as Record<string, unknown>);

    const status = asList(req.query.status).filter(isTicketStatus);
    const priority = asList(req.query.priority).filter(isTicketPriority);
    const category = asList(req.query.category).filter(isTicketCategory);

    const customerIdRaw = req.query.customer_id;
    const customerId =
      typeof customerIdRaw === 'string' && /^\d+$/.test(customerIdRaw)
        ? Number(customerIdRaw)
        : undefined;

    const { rows, hasMore } = await ticketService.listKeyset(keyset, {
      status,
      priority,
      category,
      customerId,
    });

    res.status(200).json(toPage(rows, hasMore, keyset, (row) => presenter.ticket(row)));
  } catch (error) {
    if (handled(error, res)) return;
    next(error);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      notFound(res);
      return;
    }

    /**
     * A MERGED TICKET IS RETURNED, WITH ITS POINTER. It is not an error.
     *
     * This is what the screens do, and FR-010 requires the two surfaces to tell
     * the same story about a merge. The response carries the ticket the client
     * asked for, `merged_into_ticket_id` set, so they can see it was absorbed
     * and follow it.
     *
     * The alternative a well-meaning implementation reaches for — returning the
     * SURVIVOR'S row under the requested id — is the one to avoid: a client
     * would count the same work twice in whatever system it synchronises into,
     * and nothing would ever correct it. That is not what happens here, because
     * the presenter maps the requested row.
     *
     * `TicketMergedError` exists in this codebase but comes from
     * `ticket-lifecycle.service.ts` on a WRITE attempt, so no read reaches it.
     * `api/v1/errors.ts` maps it anyway, so a future write endpoint answers the
     * published envelope rather than a 500.
     */
    const detail = await ticketService.getById(id);

    res.status(200).json(presenter.ticketDetail(detail));
  } catch (error) {
    if (handled(error, res)) return;
    next(error);
  }
}

/**
 * The ticket's correspondence.
 *
 * Kept as its own endpoint rather than embedded in the detail, because a ticket
 * with two hundred messages would otherwise make the detail response unbounded —
 * and a client fetching a ticket usually wants the ticket.
 */
export async function messages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      notFound(res);
      return;
    }

    // Proves the ticket exists and is reachable before reading its messages,
    // and raises the merged-ticket 409 for the same reason `get` does.
    await ticketService.getById(id);

    /**
     * Offset-paged, unlike the collections above, because that is what
     * `message.service.ts` provides and a thread is a different shape of thing.
     *
     * The keyset guarantee matters for a collection a client SYNCHRONISES — a
     * skipped customer is a customer that silently does not exist in their
     * database. A thread is read in one go, oldest first, in the context of a
     * ticket the client already has; a message inserted mid-read appears on the
     * next fetch. Adding keyset paging here would mean a second ordering on
     * `messages` and an index to go with it, for a guarantee nothing needs.
     */
    const thread = await messageService.listForTicket(id, {
      page: req.query.page,
      pageSize: req.query.limit,
    });

    res.status(200).json({
      data: thread.items.map((message) => ({
        id: message.id,
        direction: message.direction,
        channel: message.channel,
        body: message.body,
        // The identity the message came from or went to. NOT the author's
        // details — an outbound message's author is a member of staff, and who
        // replied is internal to this organisation.
        sender_identity: message.senderIdentity,
        delivery_state: message.deliveryState,
        occurred_at: message.occurredAt.toISOString(),
      })),
      paging: {
        page: thread.page,
        page_size: thread.pageSize,
        total: thread.total,
      },
    });
  } catch (error) {
    if (handled(error, res)) return;
    next(error);
  }
}
