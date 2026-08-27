import { sequelize } from '../config/database.js';

import * as auditService from './audit.service.js';
import * as customerService from './customer.service.js';
import type { Actor, AuditContext, ListOptions } from './customer.service.js';

/**
 * Excel guesses the encoding of a CSV without this, and Arabic customer names
 * arrive as mojibake — in the one place they are most likely to be read by
 * someone outside the team (research.md D9). It is not decoration.
 */
const UTF8_BOM = '﻿';

/** Every row is fetched in pages, so a large export is never held in memory whole. */
const EXPORT_PAGE_SIZE = 100;

const COLUMNS = ['Name', 'Company', 'Primary phone', 'Primary email', 'Status', 'Created'] as const;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);

  // A leading =, +, - or @ is interpreted as a formula by spreadsheet software.
  // Prefixing with a quote keeps a phone number like +201001234567 as text
  // rather than something the spreadsheet tries to evaluate.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;

  return `"${guarded.replace(/"/g, '""')}"`;
}

function toRow(customer: customerService.CustomerSummary): string {
  return [
    customer.displayName,
    customer.company,
    // The raw value — what someone typed — never the normalised form (rule 3).
    customer.primaryPhone?.raw ?? '',
    customer.primaryEmail ?? '',
    customer.isActive ? 'Active' : 'Inactive',
    customer.createdAt.toISOString(),
  ]
    .map(escapeCell)
    .join(',');
}

export interface ExportResult {
  csv: string;
  rowCount: number;
}

/**
 * Exports EXACTLY the rows the caller's filter produced (FR-038), never the
 * whole table, and only fields they could already see on screen (FR-039).
 *
 * The same filter shape as the list endpoint, so an export is always "what I am
 * currently looking at" rather than a separate query someone must keep in step.
 */
export async function exportCustomers(
  filters: ListOptions,
  actor: Actor,
  context: AuditContext = {},
): Promise<ExportResult> {
  const lines: string[] = [COLUMNS.map(escapeCell).join(',')];

  let page = 1;

  for (;;) {
    const result = await customerService.list({
      ...filters,
      page,
      pageSize: EXPORT_PAGE_SIZE,
    });

    for (const customer of result.items) {
      lines.push(toRow(customer));
    }

    if (page * EXPORT_PAGE_SIZE >= result.total || result.items.length === 0) {
      break;
    }

    page += 1;
  }

  const rowCount = lines.length - 1;

  // Customer data leaving the system is exactly the kind of event the audit log
  // exists for. Uses the key Phase 1 defined rather than inventing one (FR-044).
  await sequelize.transaction(async (transaction) => {
    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.DATA_EXPORTED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer',
        metadata: {
          rowCount,
          filters: {
            search: filters.search ?? null,
            company: filters.company ?? null,
            isActive: filters.isActive ?? true,
          },
        },
        ...context,
      },
      transaction,
    );
  });

  return { csv: UTF8_BOM + lines.join('\r\n') + '\r\n', rowCount };
}
