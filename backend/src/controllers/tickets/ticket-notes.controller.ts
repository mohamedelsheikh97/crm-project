import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import * as ticketNoteService from '../../services/ticket-note.service.js';
import type { Actor } from '../../services/ticket.service.js';

/**
 * HTTP concerns only. Who may edit whose note, and which mentions are
 * acceptable, are decided in ticket-note.service.ts so they hold for any caller
 * (Constitution Principle III).
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

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(
      await ticketNoteService.list(idFrom(req.params.id), {
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
    const created = await ticketNoteService.create(
      idFrom(req.params.id),
      (req.body ?? {}).body,
      actorFrom(req),
    );

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await ticketNoteService.update(
          idFrom(req.params.id),
          idFrom(req.params.noteId),
          (req.body ?? {}).body,
          actorFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

/**
 * Feeds the mention picker. Returns only users who can open this ticket, so the
 * picker cannot offer a choice the save would then refuse (FR-036, FR-037).
 */
export async function mentionable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({
      items: await ticketNoteService.mentionableUsers(idFrom(req.params.id), req.query.q),
    });
  } catch (error) {
    next(error);
  }
}
