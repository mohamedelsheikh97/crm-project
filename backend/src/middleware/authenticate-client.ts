import type { NextFunction, Request, Response } from 'express';

import type { PermissionKey } from '../auth/permissions.js';
import * as apiClientService from '../services/api-client.service.js';

/**
 * THE FOURTH IDENTITY REALM (Phase 11, FR-014 - FR-016, research D1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MACHINE CREDENTIALS ONLY. A STAFF JWT IS REFUSED HERE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `routes/index.ts` already organises this system by identity realm: staff
 * routes, `/portal` for customers, `/public` for anonymous. A published
 * interface is a fourth realm with a fourth credential type, and this middleware
 * is mounted only under `/api/v1`.
 *
 * The realms do not overlap in either direction. A staff token presented here
 * fails because it is not `<client_id>.<secret>` — there is no branch that tries
 * the other kind. A client credential presented to `/api/customers` fails
 * because that route runs `authenticate`, which expects a JWT. Neither
 * middleware has to ask which sort of thing it is holding, which is the whole
 * reason they are separate mounts rather than one chain with a conditional.
 *
 * `req.apiClient` IS A SEPARATE FIELD FROM `req.user`, never an extra shape
 * inside it — the same decision Phase 8 recorded for `req.portal`. Sharing the
 * field would mean every `req.user` check in ten phases of code suddenly had to
 * ask what kind of subject it held, and the ones that forgot would be the bugs.
 *
 * EVERY FAILURE IS THE SAME 401. Absent header, wrong scheme, malformed value,
 * unknown client, wrong secret, expired secret, revoked client — one body for
 * all of them, so a refusal cannot be used to learn whether a client identifier
 * exists. Same discipline `authenticate` applies to a deactivated user.
 */
function refuse(res: Response): void {
  res.status(401).json({
    error: {
      code: 'UNAUTHENTICATED',
      message: 'A valid API credential is required.',
      details: [],
    },
  });
}

export async function authenticateClient(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;

  if (!header) {
    refuse(res);
    return;
  }

  const [scheme, value] = header.split(' ');

  if (scheme !== 'Bearer' || !value) {
    refuse(res);
    return;
  }

  try {
    const context = await apiClientService.verify(value);

    if (!context) {
      refuse(res);
      return;
    }

    req.apiClient = context;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * The published interface's authority gate.
 *
 * Deliberately shaped like `requirePermission` and deliberately NOT the same
 * function: that one reads `req.user.roleId` and answers with this project's
 * internal `forbidden()` envelope, while this one reads the credential's own
 * grants and answers the published error shape. One vocabulary of permission
 * KEYS (FR-015), two subjects.
 *
 * The refusal NAMES the permission required. An integrator debugging a 403
 * otherwise has to guess, and the alternative to telling them is a support
 * conversation — see `whoami` for the same reasoning.
 */
export function requireClientPermission(permission: PermissionKey) {
  return function requireClientPermissionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!req.apiClient) {
      refuse(res);
      return;
    }

    if (!apiClientService.holds(req.apiClient, permission)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `This credential does not hold ${permission}.`,
          details: [{ field: 'permission', message: permission }],
        },
      });
      return;
    }

    next();
  };
}

/**
 * The variant that answers 404 rather than 403.
 *
 * For agent performance figures, matching the decision Phase 10 made for the
 * same figures on screen: FR-030b wants the report ABSENT rather than
 * present-and-withheld, because a 403 tells the caller that per-agent figures
 * exist and somebody else can read them. The authority check is identical — same
 * key, read the same way. Only the answer differs.
 */
export function requireClientPermissionOrHide(permission: PermissionKey) {
  return function requireClientPermissionOrHideMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!req.apiClient) {
      refuse(res);
      return;
    }

    if (!apiClientService.holds(req.apiClient, permission)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.', details: [] } });
      return;
    }

    next();
  };
}
