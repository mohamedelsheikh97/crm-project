import type { NextFunction, Request, Response } from 'express';

import { toJson } from '../../reporting/figure.js';
import { InvalidFilterError, parse } from '../../reporting/filters.js';
import { InvalidPeriodError, resolve } from '../../reporting/period.js';
import * as volumeService from '../../services/report-volume.service.js';

/**
 * Volume and status reporting (Phase 10, US1).
 *
 * `received` and `openAtEnd` are returned as SEPARATE figures because FR-016
 * says they answer different questions and are commonly confused — "we had 400
 * tickets last month" means neither one on its own.
 */
export function badRequest(error: unknown, res: Response): boolean {
  if (error instanceof InvalidPeriodError) {
    res.status(400).json({ error: { code: 'invalid_period', message: error.reason, details: [] } });
    return true;
  }

  if (error instanceof InvalidFilterError) {
    res.status(400).json({
      error: { code: 'invalid_filter', message: error.message, details: [] },
    });
    return true;
  }

  return false;
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const period = await resolve(req.query.from, req.query.to);
    const filters = parse(req.query as Record<string, unknown>);

    // FR-014: a period the system predates is not a quiet month, and reporting
    // zero for it is a claim rather than an absence.
    if (!(await volumeService.hasDataFor(period))) {
      res.status(200).json({ noData: true, period, filters });
      return;
    }

    const report = await volumeService.report(period, filters);

    res.status(200).json({
      received: toJson(report.received),
      openAtEnd: toJson(report.openAtEnd),
      byStatus: toJson(report.byStatus),
      byCategory: toJson(report.byCategory),
      byChannel: toJson(report.byChannel),
      overTime: toJson(report.overTime),
    });
  } catch (error) {
    if (badRequest(error, res)) return;
    next(error);
  }
}
