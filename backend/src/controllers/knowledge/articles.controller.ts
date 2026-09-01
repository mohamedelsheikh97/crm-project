import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as articleService from '../../services/kb-article.service.js';
import type { UserActor as Actor } from '../../services/ticket.service.js';

/**
 * HTTP concerns only. Publish validation, slug derivation, and the visibility
 * rules all live in kb-article.service.ts, so the automation action and any
 * later caller get the same behaviour without a second enforcement path — the
 * rule Phase 6 fixed when its engine went through services rather than models.
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

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(
      await articleService.list(
        {
          status: req.query.status,
          categoryId: req.query.categoryId,
          audience: req.query.audience,
          q: req.query.q,
          sort: req.query.sort,
          page: req.query.page,
          pageSize: req.query.pageSize,
        },
        actorFrom(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await articleService.get(idFrom(req.params.id), actorFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // NOTE WHAT IS NOT PASSED THROUGH: `status`. A new article is a draft
    // (FR-004), and the way to guarantee that is for the request to have no
    // way to say otherwise.
    res
      .status(201)
      .json(await articleService.create(req.body ?? {}, actorFrom(req), auditContextFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await articleService.update(
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

export async function publish(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await articleService.publish(idFrom(req.params.id), actorFrom(req), auditContextFrom(req)),
      );
  } catch (error) {
    next(error);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await articleService.archive(idFrom(req.params.id), actorFrom(req), auditContextFrom(req)),
      );
  } catch (error) {
    next(error);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await articleService.restore(idFrom(req.params.id), actorFrom(req), auditContextFrom(req)),
      );
  } catch (error) {
    next(error);
  }
}

/**
 * THERE IS NO `destroy` HANDLER, and the absence is the requirement.
 *
 * FR-007: archiving removes an article from every reader surface without
 * destroying it. `kb.articles.noDeleteReason` on the archive control is where
 * a user finds out why the delete button they were looking for is not there.
 */
