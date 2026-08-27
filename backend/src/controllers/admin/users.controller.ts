import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as userService from '../../services/user.service.js';

/**
 * HTTP concerns only — no business logic, no model access. Every guard rail
 * (self-deactivation, last administrator, optimistic locking) lives in the
 * service, so it holds no matter which caller reaches it.
 */

function actorFrom(req: Request): { id: number; email: string } {
  if (!req.user) {
    throw unauthenticated();
  }

  return { id: req.user.id, email: req.user.email };
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await userService.list({
      page: req.query.page,
      pageSize: req.query.pageSize,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      roleKey: typeof req.query.roleKey === 'string' ? req.query.roleKey : undefined,
      isActive: parseBoolean(req.query.isActive),
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await userService.getById(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body ?? {};

    const created = await userService.create(
      {
        email: body.email,
        fullName: body.fullName,
        roleKey: body.roleKey,
        initialPassword: body.initialPassword,
      },
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body ?? {};

    const updated = await userService.update(
      Number(req.params.id),
      { fullName: body.fullName, roleKey: body.roleKey, version: body.version },
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await userService.setActive(
      Number(req.params.id),
      false,
      actorFrom(req),
      auditContextFrom(req),
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function reactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await userService.setActive(Number(req.params.id), true, actorFrom(req), auditContextFrom(req));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await userService.resetPassword(
      Number(req.params.id),
      (req.body ?? {}).newPassword,
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function unlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await userService.unlock(Number(req.params.id), actorFrom(req), auditContextFrom(req));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
