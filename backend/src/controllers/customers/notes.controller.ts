import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as noteService from '../../services/customer-note.service.js';

function context(req: Request): { actor: { id: number; email: string }; roleId: number } {
  if (!req.user) {
    throw unauthenticated();
  }

  return {
    actor: { id: req.user.id, email: req.user.email },
    // Passed to the service so the ownership rule is decided there, never here.
    roleId: req.user.roleId,
  };
}

function numericParam(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw notFound();
  }

  return parsed;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(
      await noteService.list(numericParam(req.params.id), {
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
    const { actor } = context(req);

    const note = await noteService.create(
      numericParam(req.params.id),
      (req.body ?? {}).body,
      actor,
      auditContextFrom(req),
    );

    res.status(201).json(note);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { actor, roleId } = context(req);

    const note = await noteService.update(
      numericParam(req.params.id),
      numericParam(req.params.noteId),
      (req.body ?? {}).body,
      actor,
      roleId,
      auditContextFrom(req),
    );

    res.status(200).json(note);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { actor, roleId } = context(req);

    await noteService.remove(
      numericParam(req.params.id),
      numericParam(req.params.noteId),
      actor,
      roleId,
      auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
