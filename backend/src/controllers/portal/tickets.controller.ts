import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../../errors/app-error.js';
import * as auditService from '../../services/audit.service.js';
import * as messageAttachmentService from '../../services/message-attachment.service.js';
import * as portalTicketService from '../../services/portal-ticket.service.js';

/**
 * The customer's own requests (Phase 8).
 *
 * Every handler starts by requiring `req.portal` and hands the session to the
 * service. THE SESSION IS THE ONLY SOURCE OF IDENTITY here: no handler reads a
 * customer id, a contact id, or a ticket id from the request, and none may be
 * added (FR-015). What arrives from the client is a REFERENCE — which the service
 * resolves through `portalScope` before it means anything.
 */

function session(req: Request) {
  if (!req.portal) throw unauthenticated();
  return req.portal;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = await portalTicketService.list(session(req), {
      page: req.query.page,
      pageSize: req.query.pageSize,
    });

    res.status(200).json(page);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { subject, description, category, priority } = req.body ?? {};

    const result = await portalTicketService.submit(
      session(req),
      { subject, description, category, priority },
      auditService.auditContextFrom(req),
    );

    // The reference and nothing else. The client then reads the request back
    // through the ordinary scoped endpoint rather than being handed a
    // projection assembled on a second path.
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const view = await portalTicketService.show(session(req), req.params.reference);

    res.status(200).json(view);
  } catch (error) {
    next(error);
  }
}

export async function reply(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await portalTicketService.reply(
      session(req),
      req.params.reference,
      req.body?.body,
    );

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Streams a file from the customer's own correspondence (FR-033).
 *
 * The headers are Phase 2's, copied deliberately rather than by habit:
 *
 *   - `Content-Disposition: attachment` so nothing renders in the browser's
 *     context. A customer-supplied HTML file served inline would execute on our
 *     origin.
 *   - the filename sanitised, because it is text a stranger chose and a raw
 *     newline in a header is a header-injection.
 *   - `nosniff`, so a mislabelled file is not re-interpreted as something
 *     executable.
 *   - the storage directory is never mounted or served; every byte goes through
 *     this handler.
 */
export async function downloadAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Scope FIRST: session -> ticket -> message -> attachment. Nothing here ever
    // sees a bare attachment id (research D15).
    const { messageId, attachmentId } = await portalTicketService.attachmentFor(
      session(req),
      req.params.reference,
      req.params.attachmentId,
    );

    const target = await messageAttachmentService.getScopedForDownload(messageId, attachmentId);
    const safeName = target.originalName.replace(/["\\\r\n]/g, '_');

    res.setHeader('Content-Type', target.contentType);
    res.setHeader('Content-Length', String(target.sizeBytes));
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    target.stream.on('error', next);
    target.stream.pipe(res);
  } catch (error) {
    next(error);
  }
}
