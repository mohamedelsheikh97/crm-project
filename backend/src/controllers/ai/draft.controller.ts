import type { NextFunction, Request, Response } from 'express';

import { AiUnavailableError } from '../../ai/invoke.js';
import { unauthenticated } from '../../errors/app-error.js';
import * as draftService from '../../services/ai-draft.service.js';

/**
 * Suggested reply drafting (Phase 9, US2).
 *
 * RETURNS TEXT AND CREATES NOTHING (FR-026). There is no draft id in the
 * response because there is no draft row — the agent's composer holds it, and
 * navigating away discards it.
 */
export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    const draft = await draftService.forTicket(Number(req.params.id), req.user.id);

    res.status(200).json(draft);
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      const status = error.code === 'ai_feature_disabled' ? 409 : 503;
      res.status(status).json({ error: { code: error.code, message: error.code, details: [] } });
      return;
    }

    next(error);
  }
}
