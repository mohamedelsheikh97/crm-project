import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../errors/app-error.js';
import * as portalAuthService from '../services/portal-auth.service.js';
import { verifyPortalAccessToken } from '../services/portal-token.service.js';

/**
 * THE SECOND REALM'S DOOR (Phase 8, FR-009, FR-013, FR-014, research.md D10).
 *
 * Structurally the twin of `middleware/authenticate.ts`, and for the same
 * reason that file gives: "The database read is the point. The token carries no
 * role or permission claims and none are to be added."
 *
 * Here the read matters even more than it does for staff. A withdrawn portal
 * account, a contact somebody removed, and a deactivated customer must all stop
 * working within the window Phase 1 guarantees for staff deactivation (FR-009,
 * FR-060) — and none of those facts can live in a token. So the account, its
 * contact, and the contact's customer are loaded on EVERY request. That is three
 * indexed lookups in one query against a working set of one row; it is not a
 * performance problem worth solving with a cache that would reintroduce the
 * staleness the requirement forbids.
 *
 * EVERY FAILURE IS THE SAME 401 (FR-013). Absent header, wrong scheme, expired,
 * tampered, A STAFF TOKEN, a portal refresh token, an account that is
 * `withdrawn`, an account whose contact has been removed, a deactivated
 * customer, and a refresh epoch behind the account's — all indistinguishable.
 * The middleware is deliberately not told which, exactly as Phase 1's is not:
 * a 403 anywhere in here would confirm that a valid session existed.
 *
 * A STAFF TOKEN FAILS IN `verifyPortalAccessToken`, in library code, at the
 * signature check — not in a comparison anyone here could forget to write
 * (research D1).
 */
export async function authenticatePortal(
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
    const { id } = verifyPortalAccessToken(token);
    const session = await portalAuthService.getPortalSessionContext(id);

    // Null covers "no such account", "withdrawn", "contact gone", and
    // "customer deactivated". The middleware is not told which, since all four
    // must produce the same 401.
    if (!session) {
      next(unauthenticated());
      return;
    }

    req.portal = session;

    next();
  } catch (error) {
    next(error);
  }
}
