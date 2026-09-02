import type { NextFunction, Request, Response } from 'express';

import { isEnabled } from '../../ai/features.js';
import * as similarService from '../../services/similar-ticket.service.js';
import * as ticketService from '../../services/ticket.service.js';

/**
 * Similar resolved tickets (Phase 9, US5).
 *
 * NO AI DISCLOSURE ON THIS SURFACE, here or in the component. Nothing is
 * generated — these are real tickets real people resolved — and marking them as
 * AI output would be a lie that devalues the disclosure everywhere else.
 */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ticketId = Number(req.params.id);

    // Visibility by the same path as the ticket detail endpoint: an invisible
    // ticket 404s here exactly as it does there.
    await ticketService.getById(ticketId);

    if (!isEnabled('similar')) {
      res.status(200).json({ items: [] });
      return;
    }

    res.status(200).json({ items: await similarService.forTicket(ticketId) });
  } catch (error) {
    next(error);
  }
}
