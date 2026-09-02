import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import * as slaService from '../../src/services/report-sla.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { FEBRUARY } from '../reporting/fixture-answers.js';
import { build, MONTH } from '../reporting/fixture.js';

/**
 * SLA performance reporting (Phase 10, US2, SC-005 - SC-008).
 *
 * The reconciliation test PASSES BY CONSTRUCTION, and that is the point rather
 * than a weakness. The report counts `ticket_sla`'s recorded outcome columns,
 * which is what the ticket screen displays — so they are the same number, not
 * two calculations that have to agree.
 *
 * The test exists to catch the change that would break that: somebody adding an
 * elapsed-time figure by reaching for `lib/business-hours.ts` and, in doing so,
 * starting to recompute what Phase 6 already decided. The last test in this file
 * is the one that would catch it.
 */
describe('SLA reporting', () => {
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
    return slaService.report(period, parse({}));
  }

  it('counts response and resolution outcomes as recorded', async () => {
    const period = await resolve(MONTH.from, MONTH.to);
    const outcomes = await slaService.outcomesFor(period);

    expect(outcomes.response.met).toBe(FEBRUARY.sla.responseMet);
    expect(outcomes.response.breached).toBe(FEBRUARY.sla.responseBreached);
    expect(outcomes.resolution.met).toBe(FEBRUARY.sla.resolutionMet);
    expect(outcomes.resolution.breached).toBe(FEBRUARY.sla.resolutionBreached);
  });

  it('reports response and resolution SEPARATELY, never combined (FR-020, SC-006)', async () => {
    const report = await februaryReport();

    expect(report.responseCompliance.value).toBeCloseTo(FEBRUARY.sla.responseCompliance, 10);
    expect(report.resolutionCompliance.value).toBeCloseTo(FEBRUARY.sla.resolutionCompliance, 10);

    // They are different promises with different targets. A report that averaged
    // them would produce a number describing nothing — and the two figures
    // differing in the fixture is what proves they are not the same query.
    expect(report.responseCompliance.value).not.toBe(report.resolutionCompliance.value);
  });

  it('EXCLUDES tickets with no policy and reports the exclusion (FR-023, SC-008)', async () => {
    const report = await februaryReport();

    const excluded = report.responseCompliance.excluded.find(
      (entry) => entry.reason === 'no_policy',
    );

    expect(excluded?.count).toBe(FEBRUARY.sla.excludedNoPolicy);

    // The denominator must not include it. A ticket that was never promised
    // anything counted as compliant would inflate every rate — silently.
    expect(report.responseCompliance.count).toBe(FEBRUARY.sla.withPolicy);
  });

  it('reconciles to the per-ticket SLA state, row by row (SC-005)', async () => {
    const period = await resolve(MONTH.from, MONTH.to);
    const outcomes = await slaService.outcomesFor(period);

    const { models, slaWithPolicyIn } = await import('../../src/reporting/sources.js');

    const rows = (await models.TicketSla.findAll({
      where: slaWithPolicyIn(period),
      raw: true,
    })) as unknown as Array<{
      response_breached_at: Date | null;
      resolution_breached_at: Date | null;
    }>;

    // Counted directly off the columns the ticket screen reads. Zero
    // differences — because there is one number, not two.
    const breachedResponses = rows.filter((row) => row.response_breached_at !== null).length;
    const breachedResolutions = rows.filter((row) => row.resolution_breached_at !== null).length;

    expect(outcomes.response.breached).toBe(breachedResponses);
    expect(outcomes.resolution.breached).toBe(breachedResolutions);
  });

  it('breaks down by policy and by priority, summing to the population', async () => {
    const report = await februaryReport();

    const byPolicyCount = report.byPolicy.value.reduce((sum, row) => sum + row.count, 0);
    const byPriorityCount = report.byPriority.value.reduce((sum, row) => sum + row.count, 0);

    expect(byPolicyCount).toBe(FEBRUARY.sla.withPolicy);
    expect(byPriorityCount).toBe(FEBRUARY.sla.withPolicy);
  });

  it('offers NO average elapsed time (research D3, Open Question 2)', async () => {
    const report = await februaryReport();

    // Deliberately absent. Working-hour elapsed time cannot be aggregated in
    // SQL, and the wall-clock approximation would disagree with every SLA
    // target in the system while looking entirely plausible.
    expect(Object.keys(report)).not.toContain('averageElapsed');
    expect(Object.keys(report)).not.toContain('averageResponseTime');
  });

  it('does NOT import the working-hours module (FR-007, research D3)', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../src/services/report-sla.service.ts'),
      'utf8',
    );

    /**
     * The guard on the phase's central guarantee.
     *
     * If this service ever imports `lib/business-hours.js`, somebody has begun
     * recomputing what Phase 6 already recorded — and the moment they do,
     * FR-025's reconciliation stops being structural and becomes a coincidence
     * that will eventually stop holding. Nothing else in the suite would notice.
     *
     * MATCHED AGAINST IMPORT STATEMENTS, NOT THE WHOLE FILE. The first version
     * of this test used `toContain('business-hours')` and failed on the
     * service's own doc comment — which explains at length why it must not
     * import that module. A substring check cannot tell a prohibition from a
     * violation.
     */
    const imports = source
      .split(/\r?\n/)
      .filter((line) => /^\s*import\b/.test(line) || /\bawait import\(/.test(line));

    expect(imports.join('\n')).not.toContain('business-hours');
    expect(imports.join('\n')).not.toContain('calendar.service');
  });

  it('reads the SLA table only through reporting/sources.ts (FR-007, SC-025)', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../src/services/report-sla.service.ts'),
      'utf8',
    );

    // No raw table name, and no direct model import — the coupling has one
    // address (research D2).
    expect(source).not.toContain('ticket_sla');
    expect(source).not.toMatch(/from '\.\.\/models\//);
  });
});
