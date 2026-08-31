import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../../errors/app-error.js';
import * as assignmentService from '../../services/assignment.service.js';
import { auditContextFrom } from '../../services/audit.service.js';
import type { Actor } from '../../services/ticket.service.js';

/**
 * HTTP concerns only. The FR-051 authority check — that configuring assignment
 * additionally requires `tickets:assign` — lives in the SERVICE rather than
 * here, so a route added later cannot omit it.
 */
function actorFrom(req: Request): Actor {
  if (!req.user) throw unauthenticated();

  return {
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    roleId: req.user.roleId,
  };
}

export async function getSettings(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await assignmentService.getSettings());
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await assignmentService.updateSettings(
          req.body ?? {},
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function listCompetencies(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json(await assignmentService.listCompetencies());
  } catch (error) {
    next(error);
  }
}

/** PUT, not PATCH: the resource is a set and is replaced whole. */
export async function replaceCompetencies(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await assignmentService.replaceCompetencies(
          Number(req.params.userId),
          (req.body ?? {}).categories,
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}
