import ExcelJS from 'exceljs';

import type { Figure } from '../reporting/figure.js';
import { describe as describeFilters, type ReportFilters } from '../reporting/filters.js';
import type { ResolvedPeriod } from '../reporting/figure.js';

import { AUDIT_ACTIONS, record as recordAudit, type AuditEntry } from './audit.service.js';
import { escapeCell, UTF8_BOM } from './export.service.js';
import { sequelize } from '../config/database.js';

/**
 * Report export (Phase 10, US3, FR-046 - FR-054).
 *
 * TWO SERVER FORMATS, AND PDF IS NOT ONE OF THEM. PDF is produced by the
 * browser's own print pipeline (contracts/export-contract.md), because Arabic
 * in a PDF needs an embedded font, bidirectional reordering AND contextual
 * glyph shaping — three things a JavaScript PDF library gives you none of by
 * default, and which produce a document that looks like Arabic to somebody who
 * does not read it when got subtly wrong. The browser already does all three
 * correctly for the screen the reader is looking at.
 *
 * THE CSV PRIMITIVES ARE PHASE 2'S, REUSED. `escapeCell` guards against
 * spreadsheet formula injection and `UTF8_BOM` stops Excel guessing the
 * encoding and rendering Arabic as mojibake. FR-048 and FR-049 are those two
 * fixes restated as requirements, and reimplementing them here would be exactly
 * the drift FR-007 forbids.
 */

/**
 * The row ceiling, enforced BEFORE a partial file is produced (FR-052).
 *
 * A truncated file that appears complete is the worst outcome available here —
 * worse than a refusal, because a refusal is visible and a truncation is not.
 * Somebody quotes the total from a file that stopped at 50,000 rows.
 */
export const MAX_EXPORT_ROWS = 50_000;

export class ExportTooLargeError extends Error {
  constructor(readonly rows: number) {
    super(`export would contain ${rows} rows, above the ${MAX_EXPORT_ROWS} ceiling`);
    this.name = 'ExportTooLargeError';
  }
}

export type ExportFormat = 'csv' | 'xlsx';

export interface ExportTable {
  /** Translated column headers, in order. */
  readonly columns: readonly string[];
  /** Values keyed by the same column labels. */
  readonly rows: ReadonlyArray<Readonly<Record<string, string | number | null>>>;
}

export interface ExportRequest {
  readonly reportName: string;
  readonly tables: ReadonlyArray<{ title: string; table: ExportTable }>;
  readonly period: ResolvedPeriod;
  readonly filters: ReportFilters;
  /** Whether the exporting user reads Arabic — sets sheet direction. */
  readonly rightToLeft: boolean;
}

export interface ExportResult {
  readonly filename: string;
  readonly contentType: string;
  readonly body: Buffer;
  readonly rowCount: number;
}

/**
 * The provenance block written into EVERY export (FR-003, FR-047).
 *
 * An export lands in a mailbox and gets quoted. Without this it is a table of
 * numbers with no statement of what produced them, and the recipient reasonably
 * assumes it is the whole picture — including that it reflects the period as it
 * was, which under Clarifications Q3 it does not.
 */
function provenanceRows(request: ExportRequest): Array<[string, string]> {
  const described = describeFilters(request.filters);

  const rows: Array<[string, string]> = [
    ['Report', request.reportName],
    ['Period from', request.period.from.toISOString()],
    ['Period to', request.period.to.toISOString()],
    ['Time zone', request.period.timeZone],
    ['Generated at', new Date().toISOString()],
    // Clarifications Q3's disclosure travels with the file, not only the screen.
    ['Reflects', 'records as they are now, not as they were during the period'],
  ];

  for (const [key, value] of Object.entries(described)) {
    if (value !== null && value !== '') rows.push([`Filter: ${key}`, String(value)]);
  }

  return rows;
}

function totalRows(request: ExportRequest): number {
  return request.tables.reduce((sum, entry) => sum + entry.table.rows.length, 0);
}

function assertWithinCeiling(request: ExportRequest): void {
  const rows = totalRows(request);

  // BEFORE any bytes are produced. Checking afterwards would mean deciding
  // whether to send a file that is already built, and the wrong answer there is
  // the truncation FR-052 forbids.
  if (rows > MAX_EXPORT_ROWS) throw new ExportTooLargeError(rows);
}

function toCsv(request: ExportRequest): string {
  assertWithinCeiling(request);

  const lines: string[] = [];

  for (const [key, value] of provenanceRows(request)) {
    lines.push([key, value].map(escapeCell).join(','));
  }

  for (const entry of request.tables) {
    lines.push('');
    lines.push(escapeCell(entry.title));
    lines.push(entry.table.columns.map(escapeCell).join(','));

    for (const row of entry.table.rows) {
      lines.push(entry.table.columns.map((column) => escapeCell(row[column] ?? '')).join(','));
    }
  }

  // The BOM, without which Excel guesses the encoding and Arabic arrives as
  // mojibake — in the one place it is most likely to be read by somebody
  // outside the team (Phase 2's own words).
  return UTF8_BOM + lines.join('\r\n');
}

async function toXlsx(request: ExportRequest): Promise<Buffer> {
  assertWithinCeiling(request);

  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const about = workbook.addWorksheet('About');

  // Sheet direction, so an Arabic export opens with column A on the right —
  // the only RTL concern in this format, because cell text is Unicode and the
  // spreadsheet application shapes it.
  if (request.rightToLeft) about.views = [{ rightToLeft: true }];

  for (const [key, value] of provenanceRows(request)) {
    about.addRow([key, value]);
  }

  for (const entry of request.tables) {
    // Excel sheet names cap at 31 characters and reject several punctuation
    // marks; a translated report title can exceed both.
    const name = entry.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Report';
    const sheet = workbook.addWorksheet(name);

    if (request.rightToLeft) sheet.views = [{ rightToLeft: true }];

    sheet.addRow([...entry.table.columns]);

    for (const row of entry.table.rows) {
      sheet.addRow(
        entry.table.columns.map((column) => {
          const value = row[column] ?? null;

          /**
           * NUMBERS AS NUMBERS, which is the whole reason this format exists
           * rather than a renamed CSV — a recipient can sort and total without
           * re-typing a column.
           *
           * Strings still get the formula guard: a `.xlsx` cell whose value
           * begins `=` IS a formula by definition of the format, so the risk is
           * if anything more direct here than in CSV.
           */
          if (typeof value === 'number') return value;
          if (value === null) return '';

          return /^[=+\-@]/.test(value) ? `'${value}` : value;
        }),
      );
    }

    sheet.getRow(1).font = { bold: true };
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();

  return Buffer.from(arrayBuffer);
}

export interface Actor {
  readonly id: number;
  readonly email: string;
}

/**
 * Produces the file and records that it was taken.
 *
 * The audit entry uses Phase 1's `data.exported` key rather than a new one,
 * because it is the same event Phase 2 recorded for a customer list: data
 * leaving the system, attributable to a named person (FR-051).
 */
export async function produce(
  request: ExportRequest,
  format: ExportFormat,
  actor: Actor,
  context: Pick<AuditEntry, 'ipAddress' | 'userAgent'> = {},
): Promise<ExportResult> {
  const stamp = request.period.from.toISOString().slice(0, 10);
  const rowCount = totalRows(request);

  const result: ExportResult =
    format === 'csv'
      ? {
          filename: `${request.reportName}-${stamp}.csv`,
          contentType: 'text/csv; charset=utf-8',
          body: Buffer.from(toCsv(request), 'utf8'),
          rowCount,
        }
      : {
          filename: `${request.reportName}-${stamp}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: await toXlsx(request),
          rowCount,
        };

  await sequelize.transaction(async (transaction) => {
    await recordAudit(
      {
        action: AUDIT_ACTIONS.DATA_EXPORTED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'report',
        targetLabel: request.reportName,
        metadata: {
          format,
          rowCount,
          period: {
            from: request.period.from.toISOString(),
            to: request.period.to.toISOString(),
            timeZone: request.period.timeZone,
          },
          filters: describeFilters(request.filters),
        },
        ...context,
      },
      transaction,
    );
  });

  return result;
}

/**
 * Turns a figure's array value into an export table.
 *
 * Kept here rather than in each report service so every export presents the
 * same shape, and so a figure's provenance cannot be dropped on the way out.
 */
export function tableFromFigure(value: Figure<unknown>, columns: readonly string[]): ExportTable {
  const rows = Array.isArray(value.value)
    ? (value.value as Array<Record<string, string | number | null>>)
    : [];

  return { columns, rows };
}
