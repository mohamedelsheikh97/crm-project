import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as attachmentService from '../../services/attachment.service.js';

function actorFrom(req: Request): { id: number; email: string } {
  if (!req.user) {
    throw unauthenticated();
  }

  return { id: req.user.id, email: req.user.email };
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
    res.status(200).json(await attachmentService.list(numericParam(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function upload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const created = await attachmentService.upload(
      numericParam(req.params.id),
      req.file,
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

/**
 * Streams the file through this authenticated, permission-checked endpoint.
 *
 * The storage directory is never mounted or served — serving it would make an
 * attachment reachable by anyone who obtains its address, which is the same
 * defect as not checking permission at all (FR-033).
 */
export async function download(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const target = await attachmentService.getForDownload(
      numericParam(req.params.id),
      numericParam(req.params.attachmentId),
    );

    // The original name is quoted and stripped of anything that could break the
    // header — it is user-supplied text, not a trusted value.
    const safeName = target.originalName.replace(/["\\r\n]/g, '_');

    res.setHeader('Content-Type', target.contentType);
    res.setHeader('Content-Length', String(target.sizeBytes));
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    // Never render an uploaded file inline in the browser's context.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    target.stream.on('error', next);
    target.stream.pipe(res);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await attachmentService.remove(
      numericParam(req.params.id),
      numericParam(req.params.attachmentId),
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
