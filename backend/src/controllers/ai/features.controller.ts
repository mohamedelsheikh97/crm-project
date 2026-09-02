import type { NextFunction, Request, Response } from 'express';

import { AI_FEATURES, FEATURES } from '../../ai/features.js';

/**
 * Which AI surfaces to offer this user (Phase 9).
 *
 * READ-ONLY AND SECRET-FREE (FR-064). Returns enabled flags and nothing else:
 * no API key, no base URL, no model id — and deliberately NO PROCESSING
 * LOCATION. The location is not configurable (research D2, FR-008a), and
 * returning it read-only would invite somebody to add a PATCH for it later.
 *
 * Any authenticated staff member may read this. It is not a gate: hiding a
 * surface is a convenience, and every endpoint behind it is refused
 * server-side on its own authority (Constitution Principle II).
 */
export function list(req: Request, res: Response, next: NextFunction): void {
  try {
    const features = Object.fromEntries(
      AI_FEATURES.map((key) => [key, FEATURES[key].enabled]),
    );

    res.status(200).json({ features });
  } catch (error) {
    next(error);
  }
}
