import type { NextFunction, Request, Response } from 'express';

import { permissionCatalog } from '../../auth/permissions.js';
import { unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as roleService from '../../services/role.service.js';

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await roleService.list());
  } catch (error) {
    next(error);
  }
}

/** Served from the code catalog, so the screen cannot offer a dead permission. */
export function catalog(_req: Request, res: Response): void {
  res.status(200).json({ modules: permissionCatalog() });
}

export async function replacePermissions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    const body = req.body ?? {};

    const updated = await roleService.replacePermissions(
      Number(req.params.id),
      body.permissions,
      body.version,
      { id: req.user.id, email: req.user.email },
      auditContextFrom(req),
    );

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}
