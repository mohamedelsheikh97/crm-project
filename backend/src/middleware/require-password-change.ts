import type { NextFunction, Request, Response } from 'express';

import { passwordChangeRequired } from '../errors/app-error.js';

/**
 * Paths reachable while a password change is outstanding. Anything else is
 * refused, so a forced change cannot be skipped by calling the backend directly
 * — enforcing this in a router guard alone would be the "hidden in the UI"
 * failure the Definition of done names (research.md D10).
 */
const EXEMPT_PATHS = new Set(['/api/auth/me', '/api/auth/change-password', '/api/auth/logout']);

export function requirePasswordChange(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.mustChangePassword) {
    next();
    return;
  }

  // Matched against the full path rather than req.path, which is relative to
  // wherever this middleware happens to be mounted. The exemption must not
  // silently change meaning when a router is remounted.
  const [path] = req.originalUrl.split('?');

  if (path && EXEMPT_PATHS.has(path)) {
    next();
    return;
  }

  next(passwordChangeRequired());
}
