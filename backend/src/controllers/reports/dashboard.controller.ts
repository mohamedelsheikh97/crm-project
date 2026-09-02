import type { NextFunction, Request, Response } from 'express';

import type { PermissionKey } from '../../auth/permissions.js';
import { toJson, type Figure } from '../../reporting/figure.js';
import { FIGURE_CATALOG, FIGURE_KEYS, type FigureKey } from '../../reporting/figures.js';
import { parse } from '../../reporting/filters.js';
import { resolve } from '../../reporting/period.js';
import * as arrangementService from '../../services/dashboard-arrangement.service.js';
import * as aiService from '../../services/report-ai.service.js';
import { getRolePermissions } from '../../services/authorization.service.js';
import * as volumeService from '../../services/report-volume.service.js';

import { badRequest } from './volume.controller.js';

/**
 * The management dashboard (Phase 10, US1 and US6, FR-037 - FR-045d).
 *
 * ONE REQUEST RETURNING EVERY FIGURE, not one request per tile.
 *
 * FR-002 requires the figures on a surface to agree, and twelve independent
 * requests resolve twelve period boundaries — producing a dashboard whose total
 * does not match its own breakdown, by a day's worth of tickets, for no reason a
 * reader could see. Resolving the period once here is what makes the agreement
 * structural rather than lucky.
 *
 * It is also the endpoint FR-045's interval refresh calls, so it is the one
 * whose cost matters most: SC-018 is measured against it with the maximum
 * supported number of dashboards refreshing.
 */

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const period = await resolve(req.query.from, req.query.to);
    const filters = parse(req.query as Record<string, unknown>);

    if (!(await volumeService.hasDataFor(period))) {
      res.status(200).json({ noData: true, period, filters, figures: {}, computedAt: new Date() });
      return;
    }

    const held = req.user ? await getRolePermissions(req.user.roleId) : new Set<PermissionKey>();

    const volume = await volumeService.report(period, filters);

    /**
     * The AI figures are computed only if the viewer may see them.
     *
     * Not merely filtered out afterwards: computing them for a reader who
     * cannot have them would spend queries on every interval refresh to produce
     * something discarded — on the endpoint whose cost SC-018 measures.
     */
    const wantsAi = held.has('ai:manage');
    const ai = wantsAi ? await aiService.report(period, filters) : null;

    const all: Record<FigureKey, Figure<unknown> | null> = {
      'volume.received': volume.received,
      'volume.openAtEnd': volume.openAtEnd,
      'volume.byStatus': volume.byStatus,
      'volume.byCategory': volume.byCategory,
      'volume.byChannel': volume.byChannel,
      'volume.overTime': volume.overTime,
      'ai.byFeature': ai?.byFeature ?? null,
      'ai.proposalAcceptance': ai?.proposalAcceptance ?? null,
      'ai.deflectionRate': ai?.deflectionRate ?? null,
    };

    /**
     * FR-042: an unentitled figure is ABSENT, not refused.
     *
     * Refusing the whole dashboard because one tile is out of reach would make
     * a supervisor's entire surface fail for a figure they never asked for —
     * and they would have no way to tell that from an outage. Absence is
     * legible: the tile is not there.
     */
    const figures: Record<string, unknown> = {};

    for (const key of FIGURE_KEYS) {
      const figure = all[key];

      if (figure === null || !held.has(FIGURE_CATALOG[key])) continue;

      figures[key] = toJson(figure);
    }

    res.status(200).json({
      figures,
      /**
       * The viewer's own arrangement, so the client needs no second request to
       * lay the dashboard out — and cannot render a layout resolved against a
       * different period from the figures.
       */
      layout: req.user ? await arrangementService.forUser(req.user.id, [...held]) : [],
      // FR-043: the dashboard states when its figures were computed. With
      // interval refresh this is the last SUCCESSFUL computation, and the
      // client keeps the previous value on a failed refresh rather than
      // advancing this (FR-045d).
      computedAt: new Date().toISOString(),
      contentRetained: false,
    });
  } catch (error) {
    if (badRequest(error, res)) return;
    next(error);
  }
}

/**
 * The viewer's OWN arrangement (Phase 10, US6, FR-040).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO ID PARAMETER, EVER. THAT IS THE WHOLE SECURITY MODEL HERE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The route is `/dashboard/arrangement`, not `/dashboard/arrangement/:userId`.
 * An id parameter would need a check, the check would need testing, and the
 * failure mode is reading or overwriting somebody else's dashboard. A route
 * with nothing to get wrong cannot get it wrong — the user id comes from the
 * session and from nowhere else.
 */
export async function getArrangement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ error: { code: 'unauthenticated', message: 'unauthenticated', details: [] } });
      return;
    }

    const held = await getRolePermissions(req.user.roleId);

    res.status(200).json({
      layout: await arrangementService.forUser(req.user.id, [...held]),
      // The catalog the client may choose from, already filtered by authority —
      // so a picker cannot offer a figure the dashboard would then omit.
      available: FIGURE_KEYS.filter((key) => held.has(FIGURE_CATALOG[key])),
    });
  } catch (error) {
    next(error);
  }
}

export async function putArrangement(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ error: { code: 'unauthenticated', message: 'unauthenticated', details: [] } });
      return;
    }

    const layout = await arrangementService.save(req.user.id, req.body?.layout);

    res.status(200).json({ layout });
  } catch (error) {
    if (error instanceof arrangementService.InvalidLayoutError) {
      /**
       * REFUSED, not stored-and-later-ignored (data-model.md).
       *
       * A layout that quietly accumulates dead keys looks broken to its owner:
       * they saved six tiles, five appear, and nothing tells them why. The
       * error names the offending keys so a client can say which.
       */
      res.status(400).json({
        error: { code: 'invalid_layout', message: error.message, details: error.keys },
      });
      return;
    }

    next(error);
  }
}

/**
 * Re-exported from `reporting/figures.ts`, which is where the catalog lives so
 * the arrangement SERVICE can read it without importing a controller.
 */
export {
  FIGURE_CATALOG,
  FIGURE_KEYS,
  isFigureKey,
  type FigureKey,
} from '../../reporting/figures.js';
