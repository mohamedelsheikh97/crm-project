import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../errors/app-error.js';
import { verifyAccessToken } from '../services/token.service.js';

/**
 * Every failure path — header absent, wrong scheme, expired, bad signature, or
 * a refresh token presented where an access token belongs — produces the same
 * 401. The response never distinguishes them (FR-003).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header) {
    next(unauthenticated());
    return;
  }

  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    next(unauthenticated());
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
}
