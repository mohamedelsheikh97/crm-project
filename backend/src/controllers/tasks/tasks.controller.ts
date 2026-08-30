import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import * as taskService from '../../services/task.service.js';
import type { Actor } from '../../services/ticket.service.js';

/**
 * HTTP concerns only. Ownership — which is the whole access control for tasks —
 * is enforced in task.service.ts, so it holds for any caller (Principle III).
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

function idFrom(value: unknown): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id < 1) {
    throw notFound();
  }

  return id;
}

function optionalId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 ? id : undefined;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(
      await taskService.list(actorFrom(req), {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        ticketId: optionalId(req.query.ticketId),
        customerId: optionalId(req.query.customerId),
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
    res.status(201).json(await taskService.create(req.body ?? {}, actorFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(await taskService.update(idFrom(req.params.id), req.body ?? {}, actorFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function complete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await taskService.complete(idFrom(req.params.id), actorFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function reopen(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await taskService.reopen(idFrom(req.params.id), actorFrom(req)));
  } catch (error) {
    next(error);
  }
}
