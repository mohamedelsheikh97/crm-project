import type { NextFunction, Request, Response } from 'express';

import * as auditService from '../../services/audit.service.js';

/**
 * Read-only by construction. There is no create, update, or delete handler in
 * this file and no route for one — append-only is enforced by the absence of a
 * write path, not by a check inside one (FR-035).
 */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorUserId = Number(req.query.actorUserId);

    const result = await auditService.list({
      page: req.query.page,
      pageSize: req.query.pageSize,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      actorUserId: Number.isFinite(actorUserId) ? actorUserId : undefined,
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
      outcome:
        req.query.outcome === 'success' || req.query.outcome === 'failure'
          ? req.query.outcome
          : undefined,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function actions(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ actions: await auditService.distinctActions() });
  } catch (error) {
    next(error);
  }
}
