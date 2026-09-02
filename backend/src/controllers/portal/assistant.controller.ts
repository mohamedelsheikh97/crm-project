import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../../errors/app-error.js';
import { AlreadyEscalatedError, escalate } from '../../services/assistant-escalation.service.js';
import { AssistantUnavailableError, respond } from '../../services/assistant.service.js';

/**
 * The portal assistant (Phase 9, US3).
 *
 * A REFUSAL IS A 200, NOT AN ERROR. "I cannot answer that, shall I raise a
 * request?" is the system working correctly (research D3 step 2), and rendering
 * it as a failure would teach customers that the assistant is broken when it is
 * being careful.
 */
export async function message(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.portal) {
      next(unauthenticated());
      return;
    }

    const { conversationId, body } = req.body ?? {};

    const reply = await respond(
      { portalAccountId: req.portal.accountId },
      typeof conversationId === 'number' ? conversationId : null,
      typeof body === 'string' ? body : '',
    );

    res.status(200).json({
      conversationId: reply.conversationId,
      reply: { body: reply.body, citedArticles: reply.citedArticles },
      // The offer to escalate. Never an automatic escalation: the customer
      // decides whether their question is worth a person's time.
      escalation: null,
      needsHuman: reply.needsHuman,
    });
  } catch (error) {
    if (error instanceof AssistantUnavailableError) {
      if (error.code === 'not_found') {
        // Another account's conversation is NOT FOUND, never forbidden — a 403
        // would confirm it exists (Phase 8's rule).
        res.status(404).json({ error: { code: 'not_found', message: 'not_found', details: [] } });
        return;
      }

      const status = error.code === 'ai_feature_disabled' ? 409 : 503;
      res.status(status).json({ error: { code: error.code, message: error.code, details: [] } });
      return;
    }

    next(error);
  }
}

export async function escalateConversation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.portal) {
      next(unauthenticated());
      return;
    }

    const result = await escalate(Number(req.body?.conversationId));

    res.status(201).json(result);
  } catch (error) {
    // FR-036c: the second escalation is a constraint violation translated into
    // the reference the first one produced. The client renders it exactly as it
    // would a fresh one — the customer sees one ticket and one number.
    if (error instanceof AlreadyEscalatedError) {
      res.status(409).json({
        error: {
          code: 'already_escalated',
          message: 'already_escalated',
          details: [],
        },
        ticketReference: error.ticketReference,
      });
      return;
    }

    next(error);
  }
}
