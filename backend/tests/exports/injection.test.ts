import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import * as reportExport from '../../src/services/report-export.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Spreadsheet formula injection (Phase 10, US3, FR-049, SC-022).
 *
 * NOT HYPOTHETICAL HERE. The CSAT report carries customer-authored comment text
 * (FR-028), so a cell beginning `=` is something a customer can simply type. In
 * a `.xlsx` file such a cell IS a formula by definition of the format, and in
 * CSV opened by Excel it becomes one.
 *
 * The four dangerous leading characters are `=`, `+`, `-` and `@`.
 */
const HOSTILE = [
  '=1+1',
  '+1+1',
  '-1+1',
  '@SUM(A1:A9)',
  '=HYPERLINK("http://example.invalid","click")',
] as const;

describe('report exports neutralise formula injection', () => {
  let actor: { id: number; email: string };

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();

    const user = await createTestUser({ roleKey: 'supervisor' });
    actor = { id: user.id, email: user.email };
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  async function produce(format: 'csv' | 'xlsx') {
    const period = await resolve(MONTH.from, MONTH.to);

    return reportExport.produce(
      {
        reportName: 'csat',
        tables: [
          {
            title: 'Comments',
            table: {
              columns: ['comment', 'rating'],
              rows: HOSTILE.map((comment) => ({ comment, rating: 1 })),
            },
          },
        ],
        period,
        filters: parse({}),
        rightToLeft: false,
      },
      format,
      actor,
    );
  }

  it('neutralises every dangerous leading character in CSV', async () => {
    const text = (await produce('csv')).body.toString('utf8');

    for (const hostile of HOSTILE) {
      // The raw value must not appear at the start of a field. Phase 2's
      // `escapeCell` quotes and prefixes it; what matters to this test is only
      // that a spreadsheet will not evaluate it.
      expect(text).not.toContain(`,${hostile}`);
      expect(text.split(/\r\n/).some((line) => line.startsWith(hostile))).toBe(false);
    }
  });

  it('neutralises them in Excel, where the cell would BE a formula', async () => {
    const buffer = (await produce('xlsx')).body;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet('Comments');
    expect(sheet).toBeDefined();

    for (let row = 2; row <= HOSTILE.length + 1; row += 1) {
      const cell = sheet!.getCell(row, 1);

      // `formula` set on ANY cell here is the failure. Reading `.formula`
      // rather than `.value` is deliberate: exceljs reports a formula cell
      // through that property, so it is the assertion that actually bites.
      expect(cell.formula).toBeUndefined();
      expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
      expect(String(cell.value ?? '')).toMatch(/^'/);
    }
  });

  it('leaves harmless text untouched', async () => {
    const period = await resolve(MONTH.from, MONTH.to);

    const result = await reportExport.produce(
      {
        reportName: 'csat',
        tables: [
          {
            title: 'Comments',
            table: { columns: ['comment'], rows: [{ comment: 'very helpful, thank you' }] },
          },
        ],
        period,
        filters: parse({}),
        rightToLeft: false,
      },
      'csv',
      actor,
    );

    // A guard that mangles ordinary text is a guard somebody will remove. The
    // comma still forces quoting; the words must survive.
    expect(result.body.toString('utf8')).toContain('very helpful, thank you');
  });
});
