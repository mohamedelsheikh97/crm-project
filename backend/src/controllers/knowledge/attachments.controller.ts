import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated, validationError } from '../../errors/app-error.js';
import * as attachmentService from '../../services/kb-attachment.service.js';

/**
 * Pinning an article to a ticket, and unpinning it.
 *
 * Gated `tickets:update` rather than a knowledge permission: this is a change
 * to the TICKET's working context, not to the knowledge base. An agent who may
 * work the ticket may say which article answers it, and saying so changes
 * nothing about the article itself.
 */

function idFrom(value: unknown): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id < 1) throw notFound();

  return id;
}

export async function attach(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw unauthenticated();

    const outcome = await attachmentService.attach(
      idFrom(req.params.id),
      Number((req.body ?? {}).articleId),
      req.user.id,
    );

    if (!outcome.attached) {
      throw validationError([{ field: 'articleId', message: outcome.refusal! }]);
    }

    // 200, not 201, and the same either way: attaching an article that is
    // already attached is a NO-OP rather than a conflict (contract). A
    // double-click is not an error worth refusing, and a 409 would make the
    // interface handle a case that means nothing to the agent.
    res.status(200).json({ ticketId: idFrom(req.params.id), attached: true });
  } catch (error) {
    next(error);
  }
}

export async function detach(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await attachmentService.detach(idFrom(req.params.id), idFrom(req.params.articleId));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
