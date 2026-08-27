import type { NextFunction, Request, Response } from 'express';

import type { PermissionKey } from '../auth/permissions.js';
import { forbidden, unauthenticated } from '../errors/app-error.js';
import * as authorizationService from '../services/authorization.service.js';

/**
 * Translates an answer into a response. It computes nothing — the decision
 * belongs to authorization.service (Constitution Principle III, rule 1).
 */
export function requirePermission(key: PermissionKey) {
  return async function requirePermissionMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    try {
      const allowed = await authorizationService.roleHasPermission(req.user.roleId, key);
      next(allowed ? undefined : forbidden());
    } catch (error) {
      next(error);
    }
  };
}
