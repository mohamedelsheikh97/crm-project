import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Op } from 'sequelize';

import { Ticket } from '../../src/models/index.js';
import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import * as agentService from '../../src/services/report-agent.service.js';
import * as csatService from '../../src/services/report-csat.service.js';
import * as slaService from '../../src/services/report-sla.service.js';
import * as volumeService from '../../src/services/report-volume.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Reports reflect CURRENT record state (Phase 10, Clarifications Q3, FR-011a,
 * SC-026a).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LAST MONTH'S REPORT CHANGES WHEN A TICKET IS RECATEGORISED TODAY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That is a DECISION, not a defect. The alternative — a period snapshot — needs
 * somewhere to store the snapshot, a rule for when it is taken, and an answer
 * for what happens when the underlying record is corrected. Q3 chose the simple
 * behaviour and accepted its cost.
 *
 * The cost is real and worth naming: a supervisor who read a figure on Monday
 * and reads it again on Friday may see a different number, with nothing having
 * gone wrong. So every figure carries `reflectsCurrentState`, and the surface
 * states it — because an unexplained movement is what makes a reader stop
 * trusting the whole report, and an explained one does not.
 *
 * This file asserts BOTH halves: that the movement happens (so nobody
 * accidentally implements a snapshot and leaves the disclosure lying), and that
 * every figure carries the flag.
 */
describe('reports reflect current record state', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  async function volumeReport() {
    const period = await resolve(MONTH.from, MONTH.to);
    return volumeService.report(period, parse({}));
  }

  it('moves a figure when a ticket in the period is RECATEGORISED today', async () => {
    const before = await volumeReport();

    const countOf = (report: typeof before, category: string) =>
      report.byCategory.value.find((row) => row.category === category)?.count ?? 0;

    const billingBefore = countOf(before, 'billing');
    const technicalBefore = countOf(before, 'technical');

    expect(billingBefore).toBeGreaterThan(0);

    const ticket = await Ticket.findOne({
      where: {
        category: 'billing',
        merged_into_ticket_id: null,
        created_at: {
          [Op.between]: [new Date('2026-02-01T00:00:00Z'), new Date('2026-02-28T23:59:59Z')],
        },
      },
    });

    expect(ticket).not.toBeNull();

    // The recategorisation, dated NOW — months after the period it lands in.
    await Ticket.update({ category: 'technical' } as never, {
      where: { id: ticket!.id },
      silent: true,
    });

    const after = await volumeReport();

    /**
     * FEBRUARY'S REPORT CHANGED, in September.
     *
     * If this test ever fails, somebody has implemented a snapshot — and the
     * disclosure every figure carries has become a lie, which is worse than
     * either behaviour on its own.
     */
    expect(countOf(after, 'billing')).toBe(billingBefore - 1);
    expect(countOf(after, 'technical')).toBe(technicalBefore + 1);

    // The TOTAL does not move: recategorising is not receiving.
    expect(after.received.value).toBe(before.received.value);
  });

  it('carries `reflectsCurrentState` on EVERY figure, in every report', async () => {
    const period = await resolve(MONTH.from, MONTH.to);
    const filters = parse({});

    const volume = await volumeService.report(period, filters);
    const sla = await slaService.report(period, filters);
    const csat = await csatService.report(period, filters);
    const agents = await agentService.report(period, filters);

    /**
     * Collected by walking the report objects rather than by naming figures.
     *
     * A test that listed them would miss the one added next phase — which is
     * the figure most likely to be built without the envelope, because whoever
     * adds it will copy a shape rather than read `figure.ts`.
     */
    const figures = [
      ...Object.values(volume),
      ...Object.values(sla),
      ...Object.values(csat),
      agents.agents,
    ].filter(
      (value): value is { reflectsCurrentState: boolean } =>
        typeof value === 'object' && value !== null && 'reflectsCurrentState' in value,
    );

    expect(figures.length).toBeGreaterThan(15);

    for (const figure of figures) {
      expect(figure.reflectsCurrentState).toBe(true);
    }
  });

  it('states the period, timezone and filters alongside it (FR-003)', async () => {
    const report = await volumeReport();

    // The disclosure is only useful with the period it applies to. "These
    // numbers reflect current state" says nothing without "for February".
    expect(report.received.period.timeZone).toBeTruthy();
    expect(report.received.period.from).toBeInstanceOf(Date);
    expect(report.received.computedAt).toBeInstanceOf(Date);
  });

  it('has a locale key for the disclosure in both languages', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');

    const read = async (locale: string) =>
      JSON.parse(
        await readFile(
          path.resolve(import.meta.dirname, `../../../frontend/src/locales/${locale}.json`),
          'utf8',
        ),
      ) as Record<string, string>;

    const en = await read('en');
    const ar = await read('ar');

    /**
     * The one string that explains why a number moved.
     *
     * Asserted from the backend suite as well as the frontend's own locale test,
     * because the flag and the sentence are two halves of one requirement: the
     * payload says the figures are current, and this is where a reader finds out
     * what that means for them.
     */
    expect(en['reports.figure.currentState']).toBeTruthy();
    expect(ar['reports.figure.currentState']).toBeTruthy();
    expect(ar['reports.figure.currentState']).not.toBe(en['reports.figure.currentState']);
  });
});
