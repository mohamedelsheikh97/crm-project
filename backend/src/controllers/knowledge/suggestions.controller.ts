import type { NextFunction, Request, Response } from 'express';

import { notFound } from '../../errors/app-error.js';
import * as suggestionService from '../../services/kb-suggestion.service.js';

/**
 * Suggested articles for a ticket (FR-037, FR-045).
 *
 * ITS OWN REQUEST, NOT PART OF THE TICKET PAYLOAD, and that is FR-045 rather
 * than a structural preference. The ticket is what the agent is waiting for;
 * suggestion involves a tokenisation, an index scan, and a ranking pass, and
 * folding it into the ticket response would make every ticket screen wait for
 * work nobody asked for. The ticket renders, then the panel fills in.
 *
 * AN EMPTY LIST IS A REAL ANSWER (FR-041), not an error and not a loading
 * state. The interface renders it as "nothing to suggest".
 */

export async function forTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ticketId = Number(req.params.id);

    if (!Number.isInteger(ticketId) || ticketId < 1) throw notFound();

    res.status(200).json({ items: await suggestionService.suggestForTicket(ticketId) });
  } catch (error) {
    next(error);
  }
}
