import type { NextFunction, Request, Response } from 'express';

import type { PermissionKey } from '../../auth/permissions.js';

import { toJson } from '../../reporting/figure.js';
import { parse } from '../../reporting/filters.js';
import { resolve } from '../../reporting/period.js';
import * as agentService from '../../services/report-agent.service.js';
import * as volumeService from '../../services/report-volume.service.js';

import { badRequest } from './volume.controller.js';

/**
 * Agent performance reporting (Phase 10, US5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 404, NOT 403, FOR A CALLER WITHOUT `reports:view_agents` (FR-030b, D11).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A 403 says "this exists and you may not see it". For this report that is the
 * wrong answer, because FR-030b requires the report to be ABSENT rather than
 * present-and-withheld: an agent who learns that per-agent figures about them
 * exist, and that their supervisor can see them, has been told something the
 * access decision was meant to avoid telling them.
 *
 * The route-level `requirePermission` produces a 403 by default, so the gate is
 * enforced HERE instead and the route mounts without one. That is a deliberate
 * exception to this codebase's pattern — the authorization matrix test knows
 * about it, and this comment is why.
 *
 * `attributionRule` travels in the body (FR-031) rather than being documented
 * for clients to restate: the agent the figures describe cannot ask what they
 * mean, so no client should be able to render them without the definition.
 */
export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const period = await resolve(req.query.from, req.query.to);
    const filters = parse(req.query as Record<string, unknown>);

    if (!(await volumeService.hasDataFor(period))) {
      res.status(200).json({ noData: true, period, filters });
      return;
    }

    const report = await agentService.report(period, filters);

    res.status(200).json({
      attributionRule: report.attributionRule,
      agents: toJson(report.agents),
    });
  } catch (error) {
    if (badRequest(error, res)) return;
    next(error);
  }
}

/**
 * The absence FR-030b requires, as a middleware.
 *
 * Placed on the route in place of `requirePermission('reports:view_agents')`,
 * which would answer 403. Everything else about the check is identical — the
 * same permission key, read the same way — so this is a change of ANSWER, not
 * of authority.
 */
export function requireAgentReportOrHide(
  permissionCheck: (roleId: number, permission: PermissionKey) => Promise<boolean>,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        // Still 401 for an unauthenticated caller: they have not been told the
        // report exists either, and 404 here would hide a missing token.
        res
          .status(401)
          .json({ error: { code: 'unauthenticated', message: 'unauthenticated', details: [] } });
        return;
      }

      const allowed = await permissionCheck(req.user.roleId, 'reports:view_agents');

      if (!allowed) {
        res.status(404).json({ error: { code: 'not_found', message: 'not_found', details: [] } });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
