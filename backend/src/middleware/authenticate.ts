import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../errors/app-error.js';
import * as authService from '../services/auth.service.js';
import { verifyAccessToken } from '../services/token.service.js';

/**
 * Verifies the token, then loads the user's CURRENT row.
 *
 * The database read is the point. The token carries no role or permission
 * claims and none are to be added: FR-016 forbids deciding authorization from
 * claims, and FR-007 caps deactivation propagation at 60 seconds, which a
 * 15-minute token cannot honour. Reading per request makes staleness zero.
 *
 * Every failure — header absent, wrong scheme, expired, bad signature, refresh
 * token presented, user deleted, or user INACTIVE — produces the same 401. A
 * deactivated user must be indistinguishable from an invalid session; returning
 * 403 would confirm their session was valid (FR-003, FR-007).
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
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
    const { id } = verifyAccessToken(token);
    const session = await authService.getSessionContext(id);

    // Null covers both "no such user" and "inactive" — the middleware is
    // deliberately not told which, since both must produce the same 401.
    if (!session) {
      next(unauthenticated());
      return;
    }

    req.user = session;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Populates req.user when a valid token is present and does nothing otherwise.
 *
 * Used only by logout, which must stay idempotent — it succeeds with no cookie
 * and no token — while still recording WHO logged out when that is knowable.
 */
export async function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.headers.authorization) {
    next();
    return;
  }

  await authenticate(req, res, (error?: unknown) => {
    // A bad token on logout is not worth failing over; the cookie is cleared
    // either way.
    next(error instanceof Error && req.user ? error : undefined);
  });
}
