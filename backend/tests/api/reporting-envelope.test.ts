import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { FEBRUARY } from '../reporting/fixture-answers.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';
import { apiClientWith, type ApiAgent } from './helpers.js';

/**
 * Phase 10's honesty travels over the wire (Phase 11, US1, FR-012, SC-007).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `null` IS NOT `0`, AND THIS IS THE TEST THAT KEEPS IT THAT WAY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 10 spent a phase establishing that a number is not trustworthy on its
 * own, and encoded six honesty requirements as REQUIRED fields on one type so a
 * service could not forget them. A presenter is the easiest place to undo all of
 * that, in one line, with `?? 0` — written to be helpful.
 *
 * Zero is a claim: nobody was satisfied, nothing was breached. `null` is an
 * absence: this sample cannot support a rate. Serialising them the same way
 * reintroduces exactly the problem the suppression floor exists to prevent, on
 * the surface where nobody is watching the result.
 *
 * The fixture makes this testable rather than hypothetical: it has ONE
 * satisfaction response, which is below the floor, so every CSAT rate in
 * February is legitimately withheld.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;

const HONESTY_FIELDS = [
  'value',
  'count',
  'total',
  'excluded',
  'suppressed',
  'period',
  'filters',
  'computed_at',
  'reflects_current_state',
] as const;

describe('the published reporting envelope', () => {
  let client: ApiAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    client = await apiClientWith('reports:view');
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('carries every honesty field on every figure of every report', async () => {
    /**
     * Walked rather than spot-checked, and across all three reports.
     *
     * A test naming one figure would miss the one added next phase — which is
     * the figure most likely to be built without the envelope, because whoever
     * adds it will copy a shape rather than read `figure.ts`.
     */
    for (const report of ['volume', 'sla', 'csat']) {
      const response = await client.get(`/api/v1/reports/${report}?${PERIOD}`);

      expect(response.status, report).toBe(200);

      const figures = Object.entries(response.body).filter(
        ([, value]) =>
          typeof value === 'object' && value !== null && 'suppressed' in (value as object),
      );

      expect(figures.length, `${report} returned no figures`).toBeGreaterThan(0);

      for (const [key, value] of figures) {
        for (const field of HONESTY_FIELDS) {
          expect(value, `${report}.${key} is missing ${field}`).toHaveProperty(field);
        }
      }
    }
  });

  it('withholds a suppressed rate as null — NEVER as zero', async () => {
    const response = await client.get(`/api/v1/reports/csat?${PERIOD}`);

    expect(response.status).toBe(200);

    // The fixture has one response, below the floor.
    expect(response.body.average.suppressed).toBe(FEBRUARY.csat.averageSuppressed);

    /**
     * THE ASSERTION. `null`, and explicitly not `0`.
     *
     * `toBeNull` alone would pass for `undefined` in some shapes, and the
     * failure mode being guarded against is a helpful `?? 0` — so zero is ruled
     * out by name.
     */
    expect(response.body.average.value).toBeNull();
    expect(response.body.average.value).not.toBe(0);

    expect(response.body.responseRate.value).toBeNull();
    expect(response.body.responseRate.value).not.toBe(0);
  });

  it('still reports the COUNTS while withholding the rate', async () => {
    const response = await client.get(`/api/v1/reports/csat?${PERIOD}`);

    /**
     * Suppression withholds the RATE, not the fact.
     *
     * "1 response" is honest and tells the reader why the average is missing. A
     * surface that suppressed the counts too would leave a client unable to tell
     * a withheld figure from an outage.
     */
    expect(response.body.average.count).toBe(FEBRUARY.csat.responses);
    expect(response.body.responseRate.total).toBe(FEBRUARY.csat.rateableTickets);
    expect(response.body.responseRate.total).toBeGreaterThan(response.body.responseRate.count);
  });

  it('states the exclusions rather than being quietly narrower', async () => {
    const response = await client.get(`/api/v1/reports/sla?${PERIOD}`);

    const noPolicy = response.body.responseCompliance.excluded.find(
      (entry: { reason: string }) => entry.reason === 'no_policy',
    );

    /**
     * FR-004 over the wire. A ticket with no policy was never promised anything,
     * so it is excluded from the denominator — and the exclusion is REPORTED, or
     * an integrator sees a rate over six when the month had seven and has no way
     * to account for the difference.
     */
    expect(noPolicy?.count).toBe(FEBRUARY.sla.excludedNoPolicy);
    expect(response.body.responseCompliance.count).toBe(FEBRUARY.sla.withPolicy);
  });

  it('states the timezone, which is the calendar’s and not the server’s', async () => {
    const response = await client.get(`/api/v1/reports/volume?${PERIOD}`);

    /**
     * A period without its zone is not a period. "Yesterday" has to mean the
     * same day for a reader in Cairo and a client in London, and the only way a
     * client can verify that is for the response to say which zone produced it.
     */
    expect(response.body.received.period.time_zone).toBe('UTC');
    expect(response.body.received.period.from).toContain('2026-02-01');
  });

  it('flags that the figures reflect CURRENT record state', async () => {
    const response = await client.get(`/api/v1/reports/volume?${PERIOD}`);

    /**
     * Clarifications Q3, published.
     *
     * Recategorising a ticket today changes last month's report. A client that
     * stores these figures must store this flag with them, or it will one day
     * find its copy disagreeing with a fresh read and have no explanation. That
     * is exactly the movement that makes a reader stop trusting a report.
     */
    expect(response.body.received.reflects_current_state).toBe(true);
  });

  it('describes the null-not-zero rule in the document', async () => {
    const { default: supertest } = await import('supertest');
    const { default: app } = await import('../../src/app.js');

    const response = await supertest(app).get('/api/v1/openapi.json');

    /**
     * The rule has to reach the integrator, not just hold in the payload.
     *
     * A client that renders `null` as `0` has undone the suppression floor on
     * their own screen, and nothing here can stop them — but the document can at
     * least tell them, and FR-006 asks for documentation sufficient to use the
     * interface correctly.
     */
    const figure = response.body.components.schemas.Figure;

    expect(figure.required).toEqual(expect.arrayContaining([...HONESTY_FIELDS]));
    expect(figure.description).toMatch(/NULL and NOT zero|null is an absence/i);
    expect(figure.properties.value.description).toMatch(/never 0|NULL/i);
  });
});
