import type { NextFunction, Request, Response } from 'express';

import { handled } from '../../api/v1/errors.js';
import { figure, figures } from '../../api/v1/presenters/figure.presenter.js';
import { parse as parseFilters } from '../../reporting/filters.js';
import { resolve as resolvePeriod } from '../../reporting/period.js';
import * as agentService from '../../services/report-agent.service.js';
import * as csatService from '../../services/report-csat.service.js';
import * as slaService from '../../services/report-sla.service.js';
import * as volumeService from '../../services/report-volume.service.js';

/**
 * Published reporting endpoints (Phase 11, US1, FR-012, FR-013, SC-007).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 10'S FIGURES, UNCHANGED. THIS PHASE ADDS NO REPORTS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every handler calls the same service the screens call and hands the result to
 * `figure.presenter.ts`, which renames the envelope's fields and changes nothing
 * else. SC-007 requires the published figure to equal the on-screen figure
 * field for field, and the only way to be sure of that is for there to be one
 * computation.
 *
 * The period and filters go through Phase 10's own `resolve` and `parse`, so
 * "February in the business calendar's timezone" means the same thing on both
 * surfaces — including the timezone, which the envelope states.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE AGENT REPORT IS GATED SEPARATELY, AND ANSWERS 404.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FR-013 and Phase 10's FR-030b: absent rather than present-and-withheld. A 403
 * would tell a caller that per-agent figures exist and somebody else can read
 * them, which is what Clarifications Q1 decided not to say. The route applies
 * `requireClientPermissionOrHide('reports:view_agents')` — same key, same
 * reading, different answer.
 *
 * `attributionRule` travels in the body for the reason Phase 10 put it there:
 * the agent the figures describe cannot see them, so no client should be able to
 * render them without the definition.
 */
async function periodAndFilters(req: Request) {
  const period = await resolvePeriod(req.query.from, req.query.to);
  const filters = parseFilters(req.query as Record<string, unknown>);

  return { period, filters };
}

export async function volume(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period, filters } = await periodAndFilters(req);

    /**
     * FR-014's no-data case, published as it is on screen: a period the system
     * predates is not a quiet month, and answering zero for it would be a claim
     * rather than an absence.
     */
    if (!(await volumeService.hasDataFor(period))) {
      res.status(200).json({ no_data: true });
      return;
    }

    res.status(200).json(figures(await volumeService.report(period, filters)));
  } catch (error) {
    if (handled(error, res)) return;
    next(error);
  }
}

export async function sla(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period, filters } = await periodAndFilters(req);

    if (!(await volumeService.hasDataFor(period))) {
      res.status(200).json({ no_data: true });
      return;
    }

    res.status(200).json(figures(await slaService.report(period, filters)));
  } catch (error) {
    if (handled(error, res)) return;
    next(error);
  }
}

export async function csat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period, filters } = await periodAndFilters(req);

    if (!(await volumeService.hasDataFor(period))) {
      res.status(200).json({ no_data: true });
      return;
    }

    const report = await csatService.report(period, filters);

    res.status(200).json({
      // The scale and its neutral point, so no client hard-codes `3` to render
      // a diverging distribution — the same reasoning Phase 10's screen
      // endpoint applies.
      scale: csatService.CSAT_SCORES,
      neutral: csatService.CSAT_NEUTRAL,
      ...figures(report),
    });
  } catch (error) {
    if (handled(error, res)) return;
    next(error);
  }
}

export async function agents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period, filters } = await periodAndFilters(req);

    if (!(await volumeService.hasDataFor(period))) {
      res.status(200).json({ no_data: true });
      return;
    }

    const report = await agentService.report(period, filters);

    res.status(200).json({
      /**
       * The attribution rule, in the payload (Phase 10's FR-031).
       *
       * "Tickets they hold now" versus "tickets they worked on" is the
       * misreading that matters, and it is about somebody who cannot see the
       * figures to correct them. A client rendering these numbers without the
       * definition would be presenting an appraisal input it does not
       * understand.
       */
      attribution_rule: {
        key: report.attributionRule.key,
        counts_once: report.attributionRule.countsOnce,
      },
      agents: figure(report.agents),
    });
  } catch (error) {
    if (handled(error, res)) return;
    next(error);
  }
}
