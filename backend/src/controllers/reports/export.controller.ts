import type { NextFunction, Request, Response } from 'express';

import { forbidden, unauthenticated } from '../../errors/app-error.js';
import { parse } from '../../reporting/filters.js';
import { resolve } from '../../reporting/period.js';
import * as authorizationService from '../../services/authorization.service.js';
import {
  AUDIT_ACTIONS,
  auditContextFrom,
  recordAuthEvent as recordBestEffort,
} from '../../services/audit.service.js';
import * as exportService from '../../services/report-export.service.js';
import * as agentService from '../../services/report-agent.service.js';
import * as csatService from '../../services/report-csat.service.js';
import * as slaService from '../../services/report-sla.service.js';
import * as volumeService from '../../services/report-volume.service.js';

import { badRequest } from './volume.controller.js';

/**
 * Report export (Phase 10, US3).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REQUIRES `reports:export` **AND** THE EXPORTED REPORT'S OWN AUTHORITY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Both, not either. The route carries `reports:export`; this controller
 * additionally checks the report's own key. Without the second check
 * `reports:export` would become a route to the agent performance report for
 * somebody without `reports:view_agents` — which would make Clarifications Q1's
 * decision cosmetic, and would do it through the one surface that produces a
 * file somebody can forward.
 *
 * PDF IS ABSENT FROM THIS ENDPOINT, deliberately. It is produced by the
 * browser's print pipeline (contracts/export-contract.md), so there is nothing
 * for the server to do. That has one honest consequence recorded in the
 * contract: a browser print cannot be server-audited, so FR-051 is best-effort
 * for PDF and the client posts a notification rather than the server
 * guaranteeing a record.
 */
const REPORTS = {
  volume: { permission: 'reports:view' as const, onDenied: 403 as const },
  sla: { permission: 'reports:view' as const, onDenied: 403 as const },
  csat: { permission: 'reports:view' as const, onDenied: 403 as const },
  /**
   * The agent report denies with 404, matching its own endpoint.
   *
   * FR-030b requires it ABSENT rather than present-and-withheld, and answering
   * 403 here would undo on the export route what `agent.controller.ts` is
   * careful to do on the read route — telling a caller that per-agent figures
   * exist.
   */
  agents: { permission: 'reports:view_agents' as const, onDenied: 404 as const },
} as const;

type ReportName = keyof typeof REPORTS;

function isReportName(value: unknown): value is ReportName {
  return typeof value === 'string' && value in REPORTS;
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    const name = req.params.report;

    if (!isReportName(name)) {
      res.status(404).json({ error: { code: 'not_found', message: 'not_found', details: [] } });
      return;
    }

    // The report's OWN authority, on top of the route's `reports:export`.
    const allowed = await authorizationService.roleHasPermission(
      req.user.roleId,
      REPORTS[name].permission,
    );

    if (!allowed) {
      // 404 or 403, per the report — see the `onDenied` note on REPORTS.
      if (REPORTS[name].onDenied === 404) {
        res.status(404).json({ error: { code: 'not_found', message: 'not_found', details: [] } });
        return;
      }

      next(forbidden());
      return;
    }

    const format = req.body?.format;

    if (format !== 'csv' && format !== 'xlsx') {
      res.status(400).json({
        error: { code: 'invalid_format', message: 'format must be csv or xlsx', details: [] },
      });
      return;
    }

    const period = await resolve(req.query.from ?? req.body?.from, req.query.to ?? req.body?.to);
    const filters = parse({ ...(req.query as Record<string, unknown>), ...(req.body ?? {}) });

    // The reader's locale decides sheet direction, not the content's — a
    // spreadsheet's column order is chrome, and chrome follows the reader
    // (research D9).
    const rightToLeft = String(req.get('accept-language') ?? '').startsWith('ar');

    const tables = await buildTables(name, period, filters);

    const result = await exportService.produce(
      { reportName: name, tables, period, filters, rightToLeft },
      format,
      { id: req.user.id, email: req.user.email },
      auditContextFrom(req),
    );

    res
      .status(200)
      .setHeader('Content-Type', result.contentType)
      .setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.body);
  } catch (error) {
    if (error instanceof exportService.ExportTooLargeError) {
      // FR-052: a plain refusal, and NO file. A truncated file that appears
      // complete is the worst outcome available.
      res.status(413).json({
        error: { code: 'export_too_large', message: error.message, details: [] },
      });
      return;
    }

    if (badRequest(error, res)) return;
    next(error);
  }
}

/**
 * Records that a PDF print was STARTED (Phase 10, US3, T068, FR-051).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS A RECORD, NOT A CONTROL. Read that before relying on it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PDF export is the browser's own print pipeline, and a browser print cannot be
 * prevented, intercepted, or reliably observed by a server. The reader can hit
 * Ctrl+P without the application's involvement at all; they can decline the
 * print after this fires; a blocked request loses the record while the print
 * still happens.
 *
 * So the honest description is: when somebody uses the application's PDF
 * button, we note it. Presenting that as enforcement would be worse than
 * admitting the limit, because somebody would then build a policy on a control
 * that does not exist. The audit metadata says so explicitly, in the record
 * itself, so a later reader of the log is not misled either.
 *
 * It is still worth having. Most prints will go through the button, and "who
 * has been taking this report away" is answerable in the common case.
 */
export async function notifyPrint(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    const name = req.params.report;

    // Any report name the reader can actually view. The print happened on a
    // screen they were already authorised to see, so there is nothing further
    // to gate — and refusing here would only lose the record.
    if (typeof name !== 'string' || name.length > 64) {
      res
        .status(400)
        .json({ error: { code: 'invalid_report', message: 'invalid_report', details: [] } });
      return;
    }

    // `recordAuthEvent` rather than `record`: it is the non-transactional,
    // never-throws variant. There is no transaction to join here — the print
    // has already been initiated in the reader's browser, and rolling anything
    // back would not un-print it. A write failure logs loudly instead.
    await recordBestEffort({
      action: AUDIT_ACTIONS.DATA_EXPORTED,
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      targetType: 'report',
      targetLabel: name,
      metadata: {
        format: 'pdf',
        // Written into the record so whoever reads the log later knows what it
        // does and does not prove.
        enforcement: 'none',
        note: 'browser print initiated from the application; prints cannot be prevented or reliably detected',
        period:
          typeof req.body?.from === 'string' ? { from: req.body.from, to: req.body?.to } : null,
      },
      ...auditContextFrom(req),
    });

    // 204: there is nothing to say back, and a body would invite the client to
    // treat this as a gate it must wait for.
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

async function buildTables(
  name: ReportName,
  period: Awaited<ReturnType<typeof resolve>>,
  filters: ReturnType<typeof parse>,
): Promise<Array<{ title: string; table: exportService.ExportTable }>> {
  if (name === 'volume') {
    const report = await volumeService.report(period, filters);

    return [
      {
        title: 'Summary',
        table: {
          columns: ['figure', 'value'],
          rows: [
            { figure: 'received', value: report.received.value },
            { figure: 'openAtEnd', value: report.openAtEnd.value },
          ],
        },
      },
      {
        title: 'By status',
        table: exportService.tableFromFigure(report.byStatus, ['status', 'count']),
      },
      {
        title: 'By category',
        table: exportService.tableFromFigure(report.byCategory, ['category', 'count']),
      },
      {
        title: 'By channel',
        table: exportService.tableFromFigure(report.byChannel, ['channel', 'count']),
      },
      {
        title: 'Over time',
        table: exportService.tableFromFigure(report.overTime, ['bucket', 'count']),
      },
    ];
  }

  if (name === 'agents') {
    const agents = await agentService.report(period, filters);

    return [
      {
        /**
         * The attribution rule travels INTO THE FILE (FR-031).
         *
         * An exported spreadsheet outlives the screen and gets forwarded to
         * people who were not in the room. "Tickets they hold now" versus
         * "tickets they worked on" is the misreading that matters, and it is
         * about somebody who cannot see the file to correct it.
         */
        title: 'Attribution',
        table: {
          columns: ['field', 'value'],
          rows: [
            { field: 'attributionRule', value: agents.attributionRule.key },
            { field: 'countsOnce', value: String(agents.attributionRule.countsOnce) },
          ],
        },
      },
      {
        title: 'Agents',
        table: exportService.tableFromFigure(agents.agents, [
          'name',
          'assigned',
          'settled',
          'settledRate',
          'responseCompliance',
          'resolutionCompliance',
        ]),
      },
    ];
  }

  if (name === 'csat') {
    const csat = await csatService.report(period, filters);

    return [
      {
        title: 'Summary',
        table: {
          columns: ['figure', 'value', 'count', 'total'],
          rows: [
            {
              figure: 'average',
              // Suppressed figures export as EMPTY, never as 0. A zero in a
              // spreadsheet cell is a claim, and the recipient cannot see the
              // sample it rests on (FR-029).
              value: csat.average.value,
              count: csat.average.count,
              total: csat.average.total,
            },
            {
              figure: 'responseRate',
              value: csat.responseRate.value,
              count: csat.responseRate.count,
              total: csat.responseRate.total,
            },
          ],
        },
      },
      {
        title: 'Distribution',
        table: exportService.tableFromFigure(csat.distribution, ['score', 'count']),
      },
      {
        /**
         * CUSTOMER-AUTHORED TEXT, which is why the formula guard in
         * `report-export.service.ts` is not hypothetical: a comment beginning
         * `=` is something a customer can simply type.
         */
        title: 'Comments',
        table: exportService.tableFromFigure(csat.comments, [
          'ticketReference',
          'score',
          'comment',
        ]),
      },
    ];
  }

  const report = await slaService.report(period, filters);

  return [
    {
      title: 'Summary',
      table: {
        columns: ['figure', 'value', 'count'],
        rows: [
          {
            figure: 'responseCompliance',
            value: report.responseCompliance.value,
            count: report.responseCompliance.count,
          },
          {
            figure: 'resolutionCompliance',
            value: report.resolutionCompliance.value,
            count: report.resolutionCompliance.count,
          },
        ],
      },
    },
    {
      title: 'By policy',
      table: exportService.tableFromFigure(report.byPolicy, [
        'policyId',
        'count',
        'response',
        'resolution',
      ]),
    },
    {
      title: 'By priority',
      table: exportService.tableFromFigure(report.byPriority, [
        'priority',
        'count',
        'response',
        'resolution',
      ]),
    },
  ];
}
