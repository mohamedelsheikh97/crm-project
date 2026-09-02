import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import * as reportExport from '../../src/services/report-export.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * The row ceiling (Phase 10, US3, FR-052, SC-024).
 *
 * REFUSING IS THE CORRECT BEHAVIOUR, and a truncated file is the incorrect one.
 * A file that stops at the ceiling and says nothing looks complete, gets
 * forwarded, and somebody quotes a total from it. A refusal is visible.
 */
describe('over-ceiling exports', () => {
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

  async function requestOf(rowCount: number) {
    const period = await resolve(MONTH.from, MONTH.to);

    return {
      reportName: 'volume',
      tables: [
        {
          title: 'Rows',
          table: {
            columns: ['n'],
            rows: Array.from({ length: rowCount }, (_unused, index) => ({ n: index })),
          },
        },
      ],
      period,
      filters: parse({}),
      rightToLeft: false,
    } as const;
  }

  it('refuses plainly above the ceiling, in both formats', async () => {
    const request = await requestOf(reportExport.MAX_EXPORT_ROWS + 1);

    await expect(reportExport.produce(request, 'csv', actor)).rejects.toBeInstanceOf(
      reportExport.ExportTooLargeError,
    );

    await expect(reportExport.produce(request, 'xlsx', actor)).rejects.toBeInstanceOf(
      reportExport.ExportTooLargeError,
    );
  });

  it('produces NO file — the refusal comes before any bytes', async () => {
    const request = await requestOf(reportExport.MAX_EXPORT_ROWS + 1);

    // `rejects` proves nothing was returned. This asserts the stronger thing:
    // the error names the actual row count, which it can only do by having
    // counted BEFORE writing rather than while writing.
    await expect(reportExport.produce(request, 'csv', actor)).rejects.toMatchObject({
      rows: reportExport.MAX_EXPORT_ROWS + 1,
    });
  });

  it('states how large the export would have been', async () => {
    const request = await requestOf(reportExport.MAX_EXPORT_ROWS + 7);

    // "Too large" with no number leaves the reader unable to narrow the period
    // sensibly, which is the one action available to them.
    await expect(reportExport.produce(request, 'csv', actor)).rejects.toThrow(
      String(reportExport.MAX_EXPORT_ROWS + 7),
    );
  });

  it('permits an export exactly AT the ceiling', async () => {
    const request = await requestOf(reportExport.MAX_EXPORT_ROWS);

    // An off-by-one here would refuse a legitimate export, and the person
    // hitting it would have no way to tell it apart from a real overflow.
    const result = await reportExport.produce(request, 'csv', actor);

    expect(result.rowCount).toBe(reportExport.MAX_EXPORT_ROWS);
  }, 30_000);
});
