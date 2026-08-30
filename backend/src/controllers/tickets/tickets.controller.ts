import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as historyService from '../../services/ticket-history.service.js';
import * as linkService from '../../services/ticket-link.service.js';
import * as ticketDueService from '../../services/ticket-due.service.js';
import * as ticketService from '../../services/ticket.service.js';

/**
 * HTTP concerns only — no business logic, no model access. The lifecycle table,
 * the merged guard, the closed guard, and optimistic locking all live in the
 * services, so they hold for any caller (Constitution Principle III).
 */

function actorFrom(req: Request): ticketService.Actor {
  if (!req.user) {
    throw unauthenticated();
  }

  return {
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    roleId: req.user.roleId,
  };
}

/**
 * A path segment that is not a number is a route that does not exist, not a
 * lookup for a ticket whose id is NaN. Without this an unmatched literal path
 * reaches the service and produces a 500 instead of a 404 — the defect Phase 2
 * found and fixed the same way.
 */
function idFrom(value: unknown): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id < 1) {
    throw notFound();
  }

  return id;
}

function ticketId(req: Request): number {
  return idFrom(req.params.id);
}

/** Repeatable query parameters: ?status=open&status=pending. */
function asList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return undefined;
}

function assigneeFrom(value: unknown): number | 'unassigned' | undefined {
  if (value === 'unassigned') return 'unassigned';
  if (typeof value !== 'string') return undefined;

  const id = Number(value);
  return Number.isInteger(id) && id >= 1 ? id : undefined;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const customerIdRaw = req.query.customerId;
    const customerId = typeof customerIdRaw === 'string' ? Number(customerIdRaw) : NaN;

    res.status(200).json(
      await ticketService.list({
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        status: asList(req.query.status),
        priority: asList(req.query.priority),
        category: asList(req.query.category),
        assigneeId: assigneeFrom(req.query.assigneeId),
        customerId: Number.isInteger(customerId) && customerId >= 1 ? customerId : undefined,
        sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
        includeMerged: req.query.includeMerged === 'true',
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await ticketService.getById(ticketId(req)));
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const created = await ticketService.create(
      req.body ?? {},
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await ticketService.update(
          ticketId(req),
          req.body ?? {},
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

/**
 * The moves available to THIS caller on THIS ticket. The interface renders its
 * buttons from this and holds no copy of the lifecycle table.
 */
export async function transitions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await ticketService.transitionsFor(ticketId(req), actorFrom(req)));
  } catch (error) {
    next(error);
  }
}

/**
 * ONE endpoint for every lifecycle move. Separate /close and /reopen routes
 * would have meant four places that write a status, which is four places to
 * forget a check.
 */
export async function transition(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await ticketService.transition(
          ticketId(req),
          req.body ?? {},
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function assign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await ticketService.assign(
          ticketId(req),
          req.body ?? {},
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

/**
 * Set, change, or clear a due date (Phase 4, FR-019).
 *
 * PUT rather than PATCH because the whole value is replaced every time, and
 * `dueAt: null` is a clear rather than an omission — a distinction PATCH
 * semantics blur.
 */
export async function setDueDate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = (req.body ?? {}) as { dueAt?: unknown; version?: unknown };

    res.status(200).json(
      await ticketDueService.setDueDate(
        ticketId(req),
        {
          // Anything that is not a string is treated as a clear. The service
          // rejects an unparseable string, so a malformed date still fails
          // loudly rather than silently clearing.
          dueAt: typeof body.dueAt === 'string' ? body.dueAt : null,
          version: body.version,
        },
        actorFrom(req),
        auditContextFrom(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function history(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Existence is checked first, so a history request for a ticket that is not
    // there is a 404 rather than an empty page.
    const id = ticketId(req);
    await ticketService.getById(id);

    res.status(200).json(
      await historyService.list(id, {
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function merge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await ticketService.merge(
          ticketId(req),
          req.body ?? {},
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function link(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = ticketId(req);

    await linkService.create(
      id,
      (req.body ?? {}).linkedTicketId,
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(201).json(await ticketService.getById(id));
  } catch (error) {
    next(error);
  }
}

export async function unlink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = ticketId(req);

    await linkService.remove(
      id,
      idFrom(req.params.linkedId),
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(200).json(await ticketService.getById(id));
  } catch (error) {
    next(error);
  }
}
