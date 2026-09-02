import type { NextFunction, Request, Response } from 'express';

import { toJson } from '../../reporting/figure.js';
import { parse } from '../../reporting/filters.js';
import { resolve } from '../../reporting/period.js';
import * as slaService from '../../services/report-sla.service.js';
import * as volumeService from '../../services/report-volume.service.js';

import { badRequest } from './volume.controller.js';

/**
 * SLA performance (Phase 10, US2).
 *
 * Response and resolution are returned as SEPARATE figures (FR-020) and there
 * is deliberately no combined "SLA compliance" number: they are separate
 * promises with separate targets, and averaging them describes nothing.
 *
 * There is also no `averageElapsed` field. See research D3 — it cannot be
 * aggregated in SQL, and the wall-clock approximation would disagree with every
 * SLA target in the system while looking plausible.
 */
export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const period = await resolve(req.query.from, req.query.to);
    const filters = parse(req.query as Record<string, unknown>);

    if (!(await volumeService.hasDataFor(period))) {
      res.status(200).json({ noData: true, period, filters });
      return;
    }

    const report = await slaService.report(period, filters);

    res.status(200).json({
      responseCompliance: toJson(report.responseCompliance),
      resolutionCompliance: toJson(report.resolutionCompliance),
      byPolicy: toJson(report.byPolicy),
      byPriority: toJson(report.byPriority),
      overTime: toJson(report.overTime),
    });
  } catch (error) {
    if (badRequest(error, res)) return;
    next(error);
  }
}
