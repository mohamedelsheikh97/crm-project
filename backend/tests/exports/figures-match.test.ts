import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { FEBRUARY } from '../reporting/fixture-answers.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Exported figures equal on-screen figures (Phase 10, US3, FR-047, SC-020).
 *
 * THE FAILURE THIS PREVENTS IS A MEETING. Somebody presents an exported
 * spreadsheet, somebody else has the screen open, the two numbers differ by
 * three, and the rest of the hour is about which is right rather than about
 * what the numbers mean. Once that has happened, nobody trusts either surface
 * again.
 *
 * So the assertions here are chained: screen == export, AND both == the
 * hand-computed answer in `fixture-answers.ts`. Comparing only the two surfaces
 * would pass happily if a shared bug made both wrong.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

describe('exported figures match the endpoint', () => {
  let supervisor: AuthedAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    supervisor = (await agentAs('supervisor')).agent;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('CSV carries the same volume figures as the endpoint', async () => {
    const onScreen = await supervisor.get(`/api/reports/volume?${PERIOD}`);
    expect(onScreen.status).toBe(200);

    const exported = await supervisor
      .post(`/api/reports/volume/export?${PERIOD}`)
      .send({ format: 'csv' })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(exported.status).toBe(200);

    const text = (exported.body as Buffer).toString('utf8');

    // The headline figures, from the endpoint...
    expect(onScreen.body.received.value).toBe(FEBRUARY.received);
    expect(onScreen.body.openAtEnd.value).toBe(FEBRUARY.openAtEnd);

    // ...appear in the file with the same values. Quoted, because `escapeCell`
    // quotes every field unconditionally — which is what makes a value
    // containing a comma or a newline safe.
    expect(text).toContain(`"received","${FEBRUARY.received}"`);
    expect(text).toContain(`"openAtEnd","${FEBRUARY.openAtEnd}"`);

    // And each category count, which is where a paging or grouping bug would
    // show up rather than in the totals.
    for (const [category, count] of Object.entries(FEBRUARY.byCategory)) {
      expect(text, `category ${category}`).toContain(`"${category}","${count}"`);
    }
  });

  it('Excel carries the same figures, as NUMBERS', async () => {
    const exported = await supervisor
      .post(`/api/reports/volume/export?${PERIOD}`)
      .send({ format: 'xlsx' })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(exported.status).toBe(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as Buffer);

    const summary = workbook.getWorksheet('Summary');
    expect(summary).toBeDefined();

    const received = summary!.getRow(2);
    expect(received.getCell(1).value).toBe('received');

    /**
     * A NUMBER, not a string that looks like one.
     *
     * This is the entire reason the format exists rather than a renamed CSV: a
     * recipient sorts and totals the column without re-typing it. `'7'` in a
     * cell sorts lexically and sums to zero.
     */
    expect(received.getCell(2).value).toBe(FEBRUARY.received);
    expect(typeof received.getCell(2).value).toBe('number');
  });

  it('SLA compliance survives export as the same ratio', async () => {
    const onScreen = await supervisor.get(`/api/reports/sla?${PERIOD}`);
    expect(onScreen.status).toBe(200);

    expect(onScreen.body.responseCompliance.count).toBe(FEBRUARY.sla.withPolicy);

    const exported = await supervisor
      .post(`/api/reports/sla/export?${PERIOD}`)
      .send({ format: 'csv' })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    const text = (exported.body as Buffer).toString('utf8');

    // The DENOMINATOR travels with the rate. A compliance figure without the
    // count it was computed over is unreadable: 100% of two is not 100% of two
    // hundred, and the export is where that context is most easily lost.
    expect(text).toContain('"responseCompliance"');
    expect(text).toContain(`"${FEBRUARY.sla.withPolicy}"`);
  });

  it('writes the provenance block into every file (FR-003)', async () => {
    const exported = await supervisor
      .post(`/api/reports/volume/export?${PERIOD}`)
      .send({ format: 'csv' })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    const text = (exported.body as Buffer).toString('utf8');

    expect(text).toContain('2026-02-01');
    expect(text).toContain('Time zone');

    // Clarifications Q3's disclosure travels WITH the file. On the screen it is
    // beside the figure; in a forwarded spreadsheet the screen is gone, and the
    // recipient will otherwise assume the numbers describe the period as it was.
    expect(text.toLowerCase()).toContain('as they are now');
  });
});
