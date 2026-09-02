import type { NextFunction, Request, Response } from 'express';

import { AiUnavailableError } from '../../ai/invoke.js';
import { unauthenticated } from '../../errors/app-error.js';
import * as summaryService from '../../services/ai-summary.service.js';
import { SummaryNotWorthwhileError } from '../../services/ai-summary.service.js';

/**
 * Ticket thread summarisation (Phase 9, US1).
 *
 * Nothing is stored, so there is no endpoint to fetch a summary by id and no
 * "regenerate" verb — regenerating is calling this again (research D7).
 */
function ticketId(req: Request): number {
  return Number(req.params.id);
}

function lang(req: Request): 'ar' | 'en' | undefined {
  const value = req.query.lang;
  return value === 'ar' || value === 'en' ? value : undefined;
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    const summary = await summaryService.forTicket(ticketId(req), req.user.id, lang(req));

    res.status(200).json({
      text: summary.text,
      contentLang: summary.contentLang,
      generatedAt: summary.generatedAt.toISOString(),
      messageCount: summary.messageCount,
    });
  } catch (error) {
    // A short thread is not an error the reader should see as one: the panel
    // simply says there is nothing worth summarising.
    if (error instanceof SummaryNotWorthwhileError) {
      res.status(200).json({ text: null, reason: 'thread_too_short' });
      return;
    }

    // FR-003: a failure must be stated plainly, never rendered as an empty
    // summary that looks like a successful one.
    if (error instanceof AiUnavailableError) {
      const status = error.code === 'ai_feature_disabled' ? 409 : 503;
      res.status(status).json({ error: { code: error.code, message: error.code, details: [] } });
      return;
    }

    // Everything else — including NotFound from the visibility check, which
    // becomes the 404 FR-020 requires.
    next(error);
  }
}
