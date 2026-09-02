import type { NextFunction, Request, Response } from 'express';

import { toJson } from '../../reporting/figure.js';
import { parse } from '../../reporting/filters.js';
import { resolve } from '../../reporting/period.js';
import * as csatService from '../../services/report-csat.service.js';
import * as volumeService from '../../services/report-volume.service.js';

import { badRequest } from './volume.controller.js';

/**
 * Customer satisfaction reporting (Phase 10, US4).
 *
 * The response body carries the SCALE and its NEUTRAL POINT alongside the
 * figures. That is not padding: CSAT 1-5 is an ordered scale, so its chart is a
 * diverging stacked bar centred on neutral (research D7), and a client that had
 * to hard-code `3` to draw it would be a client holding a copy of the scale
 * definition. Sending it means the scale can change in one place.
 */
export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const period = await resolve(req.query.from, req.query.to);
    const filters = parse(req.query as Record<string, unknown>);

    // FR-014, shared with the volume report: a period the system predates is
    // not a quiet month, and reporting zero for it is a claim rather than an
    // absence.
    if (!(await volumeService.hasDataFor(period))) {
      res.status(200).json({ noData: true, period, filters });
      return;
    }

    const report = await csatService.report(period, filters);

    res.status(200).json({
      scale: csatService.CSAT_SCORES,
      neutral: csatService.CSAT_NEUTRAL,
      distribution: toJson(report.distribution),
      average: toJson(report.average),
      responseRate: toJson(report.responseRate),
      comments: toJson(report.comments),
    });
  } catch (error) {
    if (badRequest(error, res)) return;
    next(error);
  }
}
