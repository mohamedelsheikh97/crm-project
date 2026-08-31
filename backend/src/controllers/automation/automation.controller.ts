import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as automationService from '../../services/automation.service.js';
import type { Actor } from '../../services/ticket.service.js';

function actorFrom(req: Request): Actor {
  if (!req.user) throw unauthenticated();

  return {
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    roleId: req.user.roleId,
  };
}

/**
 * The catalog the builder screen reads.
 *
 * Served from the SAME declaration the validator and the executor read, which
 * is what makes it impossible for the screen to offer a combination the
 * validator would refuse.
 */
export async function getCatalog(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(automationService.ruleCatalog());
  } catch (error) {
    next(error);
  }
}

export async function listRules(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ items: await automationService.listRules() });
  } catch (error) {
    next(error);
  }
}

export async function getRule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await automationService.getRule(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function createRule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(201)
      .json(
        await automationService.createRule(req.body ?? {}, actorFrom(req), auditContextFrom(req)),
      );
  } catch (error) {
    next(error);
  }
}

export async function updateRule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await automationService.updateRule(
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

export async function enableRule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await automationService.setEnabled(
          Number(req.params.id),
          true,
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function disableRule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await automationService.setEnabled(
          Number(req.params.id),
          false,
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function reorderRules(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({
      items: await automationService.reorderRules(
        (req.body ?? {}).ruleIds,
        actorFrom(req),
        auditContextFrom(req),
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteRule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await automationService.deleteRule(
      Number(req.params.id),
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * The automation record (User Story 7).
 *
 * Gated by `automation:view` rather than `automation:manage`: reading what
 * automation did is a supervisor's question, and building rules is not.
 */
export async function listRuns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await automationService.listRuns(req.query));
  } catch (error) {
    next(error);
  }
}
