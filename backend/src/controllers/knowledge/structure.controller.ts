import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as categoryService from '../../services/kb-category.service.js';
import type { UserActor as Actor } from '../../services/ticket.service.js';

/**
 * Categories and guides — the shape of the knowledge base.
 *
 * READING is open to any signed-in user (User Story 2 onwards): filing is
 * mandatory (FR-010), so the article editor must be able to offer the
 * categories, and an agent browsing needs the same list. WRITING is gated
 * `kb:manage` in structure.routes.ts, because reorganising the filing changes
 * what every reader sees on the front page.
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

  if (!Number.isInteger(id) || id < 1) throw notFound();

  return id;
}

// --- Categories -----------------------------------------------------------

export async function listCategories(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json({ items: await categoryService.list() });
  } catch (error) {
    next(error);
  }
}

export async function createCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res
      .status(201)
      .json(
        await categoryService.createCategory(req.body ?? {}, actorFrom(req), auditContextFrom(req)),
      );
  } catch (error) {
    next(error);
  }
}

export async function updateCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await categoryService.updateCategory(
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

/**
 * Refused while the category still holds articles (FR-015).
 *
 * The refusal carries the COUNT, serialised beside the error envelope by the
 * error handler — which is what turns "you cannot" into "eleven articles are
 * filed here, move them first".
 */
export async function deleteCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await categoryService.deleteCategory(
      idFrom(req.params.id),
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// --- Guides ---------------------------------------------------------------

export async function listGuides(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ items: await categoryService.listGuides() });
  } catch (error) {
    next(error);
  }
}

export async function createGuide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(201)
      .json(
        await categoryService.createGuide(req.body ?? {}, actorFrom(req), auditContextFrom(req)),
      );
  } catch (error) {
    next(error);
  }
}

export async function updateGuide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await categoryService.updateGuide(
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

/**
 * PUT, not PATCH, and the whole sequence at once.
 *
 * A guide's order is one editorial decision. Accepting a partial reorder would
 * let two steps claim one position, and the reader would get an order nobody
 * chose.
 */
export async function replaceGuideSteps(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await categoryService.replaceGuideSteps(
          idFrom(req.params.id),
          (req.body ?? {}).articleIds,
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

/** Deletes the guide. The articles in it are untouched (research D9). */
export async function deleteGuide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await categoryService.deleteGuide(idFrom(req.params.id), actorFrom(req), auditContextFrom(req));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
