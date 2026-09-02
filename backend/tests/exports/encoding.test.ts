import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolve } from '../../src/reporting/period.js';
import { parse } from '../../src/reporting/filters.js';
import * as reportExport from '../../src/services/report-export.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { createTestUser } from '../helpers/auth.js';
import { MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * CSV encoding (Phase 10, US3, FR-048).
 *
 * The BOM is three bytes that decide whether an Arabic export is readable or
 * mojibake, because Excel guesses the encoding without it and guesses wrong.
 * Phase 2 already fixed this for customer exports; this file exists so a report
 * export written later cannot quietly lose it.
 */
describe('report CSV encoding', () => {
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

  async function csvOf(rows: Array<Record<string, string | number | null>>) {
    const period = await resolve(MONTH.from, MONTH.to);

    const result = await reportExport.produce(
      {
        reportName: 'volume',
        tables: [{ title: 'الحجم', table: { columns: ['category', 'count'], rows } }],
        period,
        filters: parse({}),
        rightToLeft: true,
      },
      'csv',
      actor,
    );

    return result;
  }

  it('starts the file with a UTF-8 BOM', async () => {
    const result = await csvOf([{ category: 'فواتير', count: 3 }]);

    // The bytes, not the decoded string — the whole point is what lands on disk.
    expect([...result.body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('round-trips Arabic intact', async () => {
    const result = await csvOf([{ category: 'فواتير', count: 3 }]);
    const text = result.body.toString('utf8');

    expect(text).toContain('فواتير');
    // And the sheet title too, which is the easier one to lose because it is
    // written by a different code path than the rows.
    expect(text).toContain('الحجم');
  });

  it('declares the charset in the content type', async () => {
    const result = await csvOf([{ category: 'general', count: 1 }]);

    // Belt and braces with the BOM: a browser that honours the header does not
    // need to sniff at all.
    expect(result.contentType).toContain('charset=utf-8');
  });
});
