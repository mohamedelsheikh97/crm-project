import type { NextFunction, Request, Response } from 'express';

import * as healthService from '../services/health.service.js';

export async function getHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const health = await healthService.getHealth();
    // 503 rather than a throw: a lost database must degrade the response, not
    // take the process down (Edge Cases, quickstart V11).
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  } catch (error) {
    next(error);
  }
}
