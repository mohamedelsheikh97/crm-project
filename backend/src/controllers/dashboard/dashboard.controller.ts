import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import * as dashboardService from '../../services/dashboard.service.js';
import type { UserActor as Actor } from '../../services/ticket.service.js';

/**
 * HTTP concerns only — no business logic, no model access.
 *
 * Whose queue may be viewed, what "overdue" means, and how NULL due dates sort
 * are all decided in dashboard.service.ts, so they hold for any caller
 * (Constitution Principle III).
 */

function actorFrom(req: Request): Actor {
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

function idFrom(value: unknown): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id < 1) {
    throw notFound();
  }

  return id;
}

/** Repeatable query parameters: ?status=open&status=pending. */
function asList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return undefined;
}

function asBoolean(value: unknown): boolean {
  return value === 'true' || value === '1';
}

export async function queue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userIdRaw = req.query.userId;
    const userId = typeof userIdRaw === 'string' ? Number(userIdRaw) : NaN;

    res.status(200).json(
      await dashboardService.queue(actorFrom(req), {
        // An unparseable userId is treated as absent — "my queue" — rather than
        // as a lookup for user NaN. A caller who cannot spell an id is not
        // thereby granted a view of someone else's work; the service still
        // gates a real id on dashboard:view_any.
        userId: Number.isInteger(userId) && userId >= 1 ? userId : undefined,
        status: asList(req.query.status),
        priority: asList(req.query.priority),
        overdueOnly: asBoolean(req.query.overdue),
        includeClosed: asBoolean(req.query.includeClosed),
        sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
        direction: typeof req.query.direction === 'string' ? req.query.direction : undefined,
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function customerContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json(await dashboardService.customerContext(idFrom(req.params.id)));
  } catch (error) {
    next(error);
  }
}
