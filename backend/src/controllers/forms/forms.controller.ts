import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as formService from '../../services/form.service.js';

function actorFrom(req: Request): formService.Actor {
  if (!req.user) throw unauthenticated();

  return {
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    roleId: req.user.roleId,
  };
}

function formId(req: Request): number {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) throw notFound();

  return id;
}

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await formService.list());
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(201)
      .json(await formService.create(req.body ?? {}, actorFrom(req), auditContextFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await formService.update(
          formId(req),
          req.body ?? {},
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}
