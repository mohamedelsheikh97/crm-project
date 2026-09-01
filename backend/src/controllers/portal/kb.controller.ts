import type { NextFunction, Request, Response } from 'express';

import * as searchService from '../../services/kb-search.service.js';

/**
 * Help content inside the portal (Phase 8, FR-038 - FR-046).
 *
 * THE FIRST THREE HANDLERS ARE PHASE 7'S PUBLIC ONES, RE-EXPORTED UNCHANGED —
 * not copied, not wrapped, not reimplemented. That is FR-039 ("results identical
 * to what the public help centre returns for the same query") made true by
 * construction rather than by comparison: there is only one implementation, so
 * there is nothing for the two surfaces to disagree about.
 *
 * Phase 7's Clarifications Q1 left this phase to decide deliberately whether the
 * authenticated portal reuses the public help centre or grows its own reading
 * view. It reuses it. A second implementation would have been a second place for
 * the `audience: 'customer'` and `status: 'published'` literals to be got wrong
 * — and getting them wrong on the authenticated surface would put internal
 * articles in front of customers, which is the one mistake Phase 7's public
 * controller spends forty lines of comment guarding against.
 *
 * WHY THE PORTAL MOUNTS THEM AGAIN RATHER THAN LINKING TO `/api/public/kb`:
 * a customer reading help inside the portal should not have their session
 * silently stop mattering half-way down the page. Mounting the same handler
 * behind `authenticate-portal` costs one line and keeps rate limiting, logging,
 * and future per-customer behaviour on the portal's own side of the boundary.
 *
 * NOTHING IS WIDENED. The re-exported handlers pass `audience` and `status` as
 * the same constants they always did; there is no parameter on any portal route
 * that could change them (FR-039, FR-040).
 */
export { categories, article, search } from '../public/kb.controller.js';

/** A public reader reaching page nine is enumerating; so is a portal one. */
const SUGGESTION_LIMIT = 3;

/**
 * Articles that may answer a request the customer is still typing (FR-041).
 *
 * NEW IN THIS PHASE, and the only knowledge endpoint the public surface does not
 * have — because the public surface accepts no reader-authored content at all
 * (Phase 7 FR-032b), and this one takes the customer's draft.
 *
 * IT IS SEARCH WITH THE DRAFT AS THE QUERY, exactly as Phase 7's ticket
 * suggestion is search with the ticket's text as the query (Phase 7 research D5).
 * No new relevance code, no second index, no model: which is why FR-041 costs
 * almost nothing and why its Arabic behaviour is already correct.
 *
 * THREE RESULTS, and no more. This appears beside a form somebody is trying to
 * submit. Ten suggestions is a wall to read past; three is an offer. Deflection
 * that gets in the way stops being deflection and becomes an obstacle (FR-042).
 *
 * AN EMPTY RESULT IS A NORMAL ANSWER (FR-044). No error, no message, nothing that
 * suggests the customer should wait or try again — the form works either way.
 */
export async function suggestions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const text = typeof req.query.text === 'string' ? req.query.text : '';

    // Below this, there is nothing to match on: a two-word fragment produces
    // noise, and noise beside a submit button is worse than silence. Returning
    // empty rather than refusing keeps the caller's code branch-free — this
    // endpoint has exactly one success shape.
    if (text.trim().length < 8) {
      res.status(200).json({ items: [] });
      return;
    }

    const result = await searchService.search({
      query: text,
      lang: req.portal?.language === 'ar' ? 'ar' : 'en',
      // LITERALS, for the reason Phase 7's controller states at length: an
      // endpoint that took "which articles" as input would be one signature
      // change away from serving internal content.
      audience: 'customer',
      limit: SUGGESTION_LIMIT,
    });

    res.status(200).json({
      // Rebuilt rather than passed through, so internal ids never travel — the
      // same allow-list discipline as the public article payload.
      items: result.items
        .filter((hit) => hit.slug !== null)
        .map((hit) => ({
          slug: hit.slug,
          title: hit.title,
          lang: hit.lang,
          excerpt: hit.excerpt,
        })),
    });
  } catch (error) {
    next(error);
  }
}
