import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as calendarService from '../../services/calendar.service.js';
import * as policyService from '../../services/sla-policy.service.js';
import type { Actor } from '../../services/ticket.service.js';

/**
 * HTTP concerns only. Every decision — precedence, validation, what an unknown
 * time zone means — lives in the services (Principle III).
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

// --- Policies --------------------------------------------------------------

/**
 * THE LIST ORDER IS THE PRECEDENCE ORDER (FR-013).
 *
 * The service returns them ordered as they are matched, so the screen explains
 * precedence by demonstrating it rather than by prose that could drift from
 * what the matcher actually does.
 */
export async function listPolicies(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [policies, counts] = await Promise.all([
      policyService.list(),
      policyService.openTicketCounts(),
    ]);

    res.status(200).json({
      items: policies.map((policy) => ({
        ...policy,
        // Shown beside each policy so an administrator editing a duration can
        // see how much live work it governs before they change it.
        openTicketCount: counts.get(policy.id) ?? 0,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function getPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await policyService.getById(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function createPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(201)
      .json(await policyService.create(req.body ?? {}, actorFrom(req), auditContextFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function updatePolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await policyService.update(
          Number(req.params.id),
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
 * Activate and deactivate. THERE IS NO DELETE ROUTE, and its absence is FR-019:
 * a policy tickets were measured against stays readable, so the ticket's record
 * of what it promised does not become a dangling id.
 */
export async function activatePolicy(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await policyService.setActive(
      Number(req.params.id),
      true,
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function deactivatePolicy(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Returns `{ policy, warning }`. Deactivating the last catch-all is a
    // WARNING, never a refusal: FR-014 makes "no policy" a valid state, and
    // refusing would stop an administrator switching the feature off.
    const result = await policyService.setActive(
      Number(req.params.id),
      false,
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// --- Calendar --------------------------------------------------------------

export async function getCalendar(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await calendarService.get());
  } catch (error) {
    next(error);
  }
}

export async function updateCalendar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const calendar = await calendarService.update(
      req.body ?? {},
      actorFrom(req),
      auditContextFrom(req),
    );

    // STATED EXPLICITLY, because it is the first question an administrator will
    // have and answering it in the interface is cheaper than answering it in
    // support: editing the calendar moves FUTURE targets only. FR-029 is what
    // makes that true — a target's absolute time is stored when computed.
    res.status(200).json({ ...calendar, affectedOpenTickets: 0 });
  } catch (error) {
    next(error);
  }
}

export async function addException(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(201)
      .json(
        await calendarService.addException(req.body ?? {}, actorFrom(req), auditContextFrom(req)),
      );
  } catch (error) {
    next(error);
  }
}

export async function removeException(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await calendarService.removeException(
          Number(req.params.id),
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}
