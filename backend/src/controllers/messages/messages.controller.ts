import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as messageService from '../../services/message.service.js';

/**
 * HTTP concerns only — no business logic, no model access. The channel of a
 * reply, the opt-out check, the reply window, and the retry policy all live in
 * the service, so they hold for any caller (Constitution Principle III).
 */

function actorFrom(req: Request): messageService.Actor {
  if (!req.user) throw unauthenticated();

  return {
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    roleId: req.user.roleId,
  };
}

/**
 * A path segment that is not a number is a route that does not exist, not a
 * lookup for a ticket whose id is NaN — the same guard Phases 2, 3 and 4 use.
 */
function ticketId(req: Request): number {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) throw notFound();

  return id;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(
      await messageService.listForTicket(ticketId(req), {
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * What the composer needs before the agent types: the channel, the recipient,
 * any opt-out, and what the channel currently permits (FR-051, FR-057).
 */
export async function context(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await messageService.composerContext(ticketId(req)));
  } catch (error) {
    next(error);
  }
}

export async function send(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // The CHANNEL IS NOT TAKEN FROM THE BODY. It is derived from the
    // conversation in the service, so a caller cannot redirect a reply to a
    // channel the customer never used.
    const created = await messageService.send(
      ticketId(req),
      req.body ?? {},
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function reattribute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await messageService.reattribute(
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
