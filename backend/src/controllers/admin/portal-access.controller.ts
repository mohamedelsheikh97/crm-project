import type { NextFunction, Request, Response } from 'express';

import { unauthenticated, validationError } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as portalAccessService from '../../services/portal-access.service.js';
import * as portalInvitationService from '../../services/portal-invitation.service.js';

/**
 * Staff administration of portal access (Phase 8, User Story 1 and 8).
 *
 * Every route reaching this file carries `requirePermission('portal:manage')`.
 * The permission is checked by the route rather than here, so it appears in the
 * generated authorization matrix — a handler that checked it itself would be
 * invisible to that test, which is the whole reason the project puts route gates
 * in routes.
 */

function actorFrom(req: Request): { id: number; email: string } {
  if (!req.user) throw unauthenticated();

  return { id: req.user.id, email: req.user.email };
}

function numericParam(value: unknown, field: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw validationError([{ field, message: 'A valid identifier is required.' }]);
  }

  return parsed;
}

/** Per contact: has access, invited, locked out, withdrawn (FR-056). */
export async function overview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await portalAccessService.overview(numericParam(req.params.id, 'id'));

    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
}

/**
 * Issues an invitation (FR-002).
 *
 * `provisionalWarning` travels in the RESPONSE rather than being enforced as a
 * refusal (FR-002f). Forbidding it outright would leave every customer Phase 5
 * created automatically from an inbound message permanently unable to use the
 * portal, which in a busy deployment is most of them. Telling the issuer that
 * nobody has verified this record, and letting them decide, is the honest
 * middle — and the rule lives in the service rather than the screen, so a second
 * client cannot skip the warning.
 */
export async function invite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await portalInvitationService.issue(
      numericParam(req.params.contactId, 'contactId'),
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function revokeInvitation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await portalInvitationService.revoke(
      numericParam(req.params.invitationId, 'invitationId'),
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function withdraw(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await portalAccessService.withdraw(
      numericParam(req.params.accountId, 'accountId'),
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await portalAccessService.restore(
      numericParam(req.params.accountId, 'accountId'),
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
    await portalAccessService.unlock(
      numericParam(req.params.accountId, 'accountId'),
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * Sends a password reset on the customer's behalf (FR-057).
 *
 * 204 AND NOTHING ELSE. The staff member learns that it was sent, not what the
 * password is or was — there is no path in this system by which anybody can
 * learn a customer's secret, which is the same rule Phase 1 applies to staff.
 */
export async function sendReset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await portalInvitationService.sendResetFor(
      numericParam(req.params.contactId, 'contactId'),
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
