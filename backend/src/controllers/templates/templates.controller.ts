import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as templateService from '../../services/template.service.js';
import type { UserActor as Actor } from '../../services/ticket.service.js';

/** HTTP concerns only. Language validation lives in template.service.ts. */

function actorFrom(req: Request): Actor {
  if (!req.user) throw unauthenticated();

  return {
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    roleId: req.user.roleId,
  };
}

function idFrom(value: unknown): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id < 1) {
    throw notFound();
  }

  return id;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(
      await templateService.list({
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        // Only management screens ask for retired templates; the picker never
        // does, which is what makes retirement meaningful (FR-071).
        includeRetired: req.query.includeRetired === 'true',
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(201)
      .json(await templateService.create(req.body ?? {}, actorFrom(req), auditContextFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await templateService.update(
          idFrom(req.params.id),
          req.body ?? {},
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function retire(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await templateService.retire(idFrom(req.params.id), actorFrom(req), auditContextFrom(req)),
      );
  } catch (error) {
    next(error);
  }
}
