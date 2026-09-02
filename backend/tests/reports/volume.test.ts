import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { breakdownReconciles } from '../../src/reporting/figure.js';
import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import * as volumeService from '../../src/services/report-volume.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { FEBRUARY } from '../reporting/fixture-answers.js';
import { build, MONTH } from '../reporting/fixture.js';

/**
 * Volume and status reporting (Phase 10, US1, SC-001 - SC-004).
 *
 * EVERY ASSERTION IS AGAINST A LITERAL FROM `fixture-answers.ts`, counted by
 * hand from the fixture. Not against a second query — two queries that agree
 * share the assumptions where the bug is, and this phase's whole hazard is that
 * a wrong number does not announce itself.
 *
 * If one of these fails, one of two things is true and it is worth deciding
 * which before changing anything: either the report is wrong, or the
 * hand-computed answer is. The workings are written out in the answers file so
 * that question is answerable.
 */
describe('volume reporting', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await build();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  async function februaryReport() {
    const period = await resolve(MONTH.from, MONTH.to);
    return volumeService.report(period, parse({}));
  }

  it('counts tickets RECEIVED in the period', async () => {
    const report = await februaryReport();

    expect(report.received.value).toBe(FEBRUARY.received);
  });

  it('counts tickets OPEN at the period end — a different number (FR-016)', async () => {
    const report = await februaryReport();

    expect(report.openAtEnd.value).toBe(FEBRUARY.openAtEnd);

    /**
     * The inequality IS the requirement.
     *
     * "We had 400 tickets last month" means neither figure on its own, and a
     * report that conflated them would pass a fixture where they coincided. The
     * fixture is built so they do not: seven received, six open.
     */
    expect(report.openAtEnd.value).not.toBe(report.received.value);
  });

  it('includes a ticket raised BEFORE the period that is still open in it', async () => {
    // The January ticket. A query that filtered `openAtEnd` by creation date
    // would miss it and report a much smaller, different number.
    const report = await februaryReport();

    expect(report.openAtEnd.value).toBeGreaterThan(4);
  });

  it('counts a merged pair ONCE, and says it excluded the other side (FR-017)', async () => {
    const report = await februaryReport();

    expect(report.received.value).toBe(FEBRUARY.received);

    const merged = report.received.excluded.find((entry) => entry.reason === 'merged');

    // FR-004: the exclusion is stated with its count, rather than the total
    // being quietly smaller than the table.
    expect(merged).toBeDefined();
    expect(merged?.count).toBe(1);
  });

  it('breaks down by category, and the parts reconcile to the whole (SC-002)', async () => {
    const report = await februaryReport();

    const byCategory = Object.fromEntries(
      report.byCategory.value.map((row) => [row.category, row.count]),
    );

    expect(byCategory).toMatchObject(FEBRUARY.byCategory);
    expect(breakdownReconciles(report.byCategory, report.byCategory.value)).toBe(true);
  });

  it('breaks down by channel, and reconciles', async () => {
    const report = await februaryReport();

    const byChannel = Object.fromEntries(
      report.byChannel.value.map((row) => [row.channel, row.count]),
    );

    expect(byChannel).toMatchObject(FEBRUARY.byChannel);
    expect(breakdownReconciles(report.byChannel, report.byChannel.value)).toBe(true);
  });

  it('breaks down by status, and reconciles', async () => {
    const report = await februaryReport();

    const byStatus = Object.fromEntries(
      report.byStatus.value.map((row) => [row.status, row.count]),
    );

    expect(byStatus).toMatchObject(FEBRUARY.byStatus);
    expect(breakdownReconciles(report.byStatus, report.byStatus.value)).toBe(true);
  });

  it('reports a declared bucket with ZERO rather than omitting it', async () => {
    const report = await februaryReport();

    // Every category in the Phase 3 taxonomy appears, including any nobody used
    // this month. Absence would read as "that category does not exist"; zero is
    // the fact.
    expect(report.byCategory.value).toHaveLength(4);
    expect(report.byChannel.value.some((row) => row.count === 0)).toBe(true);
  });

  it('narrows every figure consistently when a filter is applied (SC-003)', async () => {
    const period = await resolve(MONTH.from, MONTH.to);
    const billing = await volumeService.report(period, parse({ category: 'billing' }));

    expect(billing.received.value).toBe(FEBRUARY.byCategory.billing);

    // The filter is recorded in the figure, so an export cannot be read as the
    // unfiltered picture (FR-003).
    expect(billing.received.filters.category).toBe('billing');

    // And every other bucket in the breakdown is now zero, not absent.
    const byCategory = Object.fromEntries(
      billing.byCategory.value.map((row) => [row.category, row.count]),
    );

    expect(byCategory.technical).toBe(0);
    expect(byCategory.general).toBe(0);
  });

  it('refuses an unknown category rather than reporting an empty month', async () => {
    // An empty result would read as "no tickets in that category", which is a
    // claim — and a false one.
    expect(() => parse({ category: 'refunds' })).toThrow();
  });

  it('buckets the time series inside the period and sums to the total', async () => {
    const report = await februaryReport();

    const summed = report.overTime.value.reduce((total, row) => total + row.count, 0);

    expect(summed).toBe(FEBRUARY.received);

    for (const row of report.overTime.value) {
      expect(row.bucket.startsWith('2026-02')).toBe(true);
    }
  });

  it('distinguishes an empty period from one the system predates (FR-014)', async () => {
    const before = await resolve('2019-01-01', '2019-01-31');
    const inRange = await resolve(MONTH.from, MONTH.to);

    expect(await volumeService.hasDataFor(before)).toBe(false);
    expect(await volumeService.hasDataFor(inRange)).toBe(true);
  });

  it('carries the current-state disclosure on every figure (FR-011a)', async () => {
    const report = await februaryReport();

    for (const value of Object.values(report)) {
      expect(value.reflectsCurrentState).toBe(true);
      expect(value.period.timeZone).toBe('UTC');
      expect(value.computedAt).toBeInstanceOf(Date);
    }
  });
});
