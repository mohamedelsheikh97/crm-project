import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../../errors/app-error.js';
import * as satisfactionService from '../../services/satisfaction.service.js';

/** Post-resolution rating (Phase 8, FR-047 - FR-055). */
export async function submit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.portal) {
      next(unauthenticated());
      return;
    }

    const { score, comment } = req.body ?? {};

    const view = await satisfactionService.submit(req.portal, req.params.reference, {
      score,
      comment,
    });

    res.status(201).json(view);
  } catch (error) {
    // A second submission arrives here as ALREADY_RECORDED (409) from the unique
    // index, not from a preceding read. Nothing to translate: the service is the
    // only place that knows the difference between "first" and "again".
    next(error);
  }
}
