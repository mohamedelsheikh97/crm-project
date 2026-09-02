import type { NextFunction, Request, Response } from 'express';

import { document } from '../../api/openapi.js';
import { send } from '../../api/v1/errors.js';

/**
 * The interface describing itself (Phase 11, US1, FR-005, FR-006).
 */

/**
 * `whoami` — what this credential actually holds.
 *
 * It exists because of a support conversation nobody should have to have. The
 * first question behind every `403` is "what do I have?", and without this
 * endpoint the only way for an integrator to find out is to ask us, wait, and be
 * told by a person reading a database. FR-006 asks for documentation sufficient
 * to make a successful first request; this is the part of that which cannot be
 * written down in advance, because it is specific to their credential.
 *
 * It returns the credential's own name and permissions and NOTHING about the
 * organisation — no user count, no role list, no other credentials. A caller
 * learns what they can do, not what exists.
 */
export function whoami(req: Request, res: Response, next: NextFunction): void {
  try {
    if (!req.apiClient) {
      send(res, 401, 'UNAUTHENTICATED', 'A valid API credential is required.');
      return;
    }

    res.status(200).json({
      client_id: req.apiClient.clientId,
      name: req.apiClient.name,
      // Sorted, so a client diffing this across deployments sees a stable
      // order rather than whatever the database returned.
      permissions: [...req.apiClient.permissions].sort(),
      api_version: '1',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * The machine-readable description, UNAUTHENTICATED.
 *
 * Mounted outside the authenticator, deliberately: an integrator reads this
 * BEFORE they have a working credential — it is the first thing they open — and
 * requiring one would make the documentation unreachable to exactly the person
 * who needs it most. It describes shapes, never data, so there is nothing in it
 * to protect.
 *
 * DERIVED FROM THE SCHEMAS, not maintained beside them (FR-005). Hand-written
 * API documentation is wrong within weeks, and wrong documentation is worse than
 * none because an integrator trusts it and debugs their own code first.
 */
export function openapi(_req: Request, res: Response, next: NextFunction): void {
  try {
    res.status(200).json(document());
  } catch (error) {
    next(error);
  }
}
