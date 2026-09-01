import type { NextFunction, Request, Response } from 'express';

import * as searchService from '../../services/kb-search.service.js';

/**
 * Agent-facing search (FR-017 to FR-029).
 *
 * NOTE WHAT IS NOT READ FROM THE REQUEST: `audience`.
 *
 * This controller passes `'internal'` as a LITERAL, exactly as the public
 * controller passes `'customer'` (research D7, FR-032c). Visibility is a
 * property of the SURFACE somebody arrived through, never of what they asked
 * for. An endpoint that accepted it as a parameter would be one signature
 * change away from serving internal content to the public surface, and that
 * change would look harmless in review.
 *
 * `lang` IS a request parameter, because it is a genuine reader preference
 * rather than an authority — and being handed the wrong one is a nuisance
 * rather than a disclosure.
 */

function language(value: unknown, fallback: 'en' | 'ar'): 'en' | 'ar' {
  return value === 'ar' || value === 'en' ? value : fallback;
}

export async function search(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categoryId = Number(req.query.categoryId);

    res.status(200).json(
      await searchService.search({
        query: typeof req.query.q === 'string' ? req.query.q : '',
        lang: language(req.query.lang, 'en'),
        // A LITERAL. See the note above.
        audience: 'internal',
        categoryId: Number.isInteger(categoryId) && categoryId > 0 ? categoryId : undefined,
      }),
    );
  } catch (error) {
    next(error);
  }
}
