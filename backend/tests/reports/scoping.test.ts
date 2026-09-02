import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import * as agentService from '../../src/services/report-agent.service.js';
import * as volumeService from '../../src/services/report-volume.service.js';
import { agentAs, type AuthedAgent } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { build, MONTH, ensureUtcCalendar } from '../reporting/fixture.js';

/**
 * Scoping happens IN THE QUERY (Phase 10, FR-060, FR-061, SC-027).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY "IN THE QUERY" RATHER THAN "IN THE RESULT" IS A REQUIREMENT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Filtering after the fact gives the right answer and the wrong properties. The
 * rows still leave the database, the paging is computed over a population the
 * caller may not see (so page two is short for no visible reason), and the count
 * in a `total` is the unfiltered one — which is itself a disclosure: "there are
 * 900 tickets, you may see 40" tells you something about the 860.
 *
 * Two halves, and both are here:
 *
 *   1. STRUCTURAL. Every report population comes from `reporting/sources.ts`,
 *      whose builders return `where` clauses — so the narrowing is in SQL by
 *      construction. Asserted by reading the source, because a runtime test
 *      cannot see WHERE the filtering happened.
 *   2. BEHAVIOURAL. No response contains a record the caller could not obtain
 *      directly from the surface that owns it.
 */
const PERIOD = `from=${MONTH.from}&to=${MONTH.to}`;
const SERVICES_DIR = path.resolve(import.meta.dirname, '../../src/services');

/**
 * `report-*.service.ts` files that read no population, and why.
 *
 * Named rather than filtered by behaviour: a rule like "files that mention
 * `sources.models`" would let a service that stopped querying drop silently out
 * of every check below, which is the vacuous-pass failure this suite is
 * otherwise careful about. The reconciliation test asserts every file is either
 * checked or listed here.
 */
const NOT_A_POPULATION_READER: Readonly<Record<string, string>> = {
  'report-export.service.ts':
    'writes a file from figures another service already computed; its only query is the audit insert',
};

async function populationReaders(): Promise<string[]> {
  const entries = await readdir(SERVICES_DIR);

  return entries
    .filter((name) => /^report-.*\.service\.ts$/.test(name))
    .filter((name) => !(name in NOT_A_POPULATION_READER));
}

describe('report scoping', () => {
  let supervisor: AuthedAgent;
  let staffAgent: AuthedAgent;

  beforeAll(async () => {
    await setupTestDatabase();
    await truncateAll();
    await ensureUtcCalendar();
    await build();

    supervisor = (await agentAs('supervisor')).agent;
    staffAgent = (await agentAs('agent')).agent;
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('accounts for every report service — checked, or listed as an exception', async () => {
    const entries = await readdir(SERVICES_DIR);
    const all = entries.filter((name) => /^report-.*\.service\.ts$/.test(name));
    const checked = await populationReaders();

    // Neither list may quietly shrink. A service that stopped being checked
    // without being listed is the vacuous pass this suite exists to avoid.
    expect([...checked, ...Object.keys(NOT_A_POPULATION_READER)].sort()).toEqual(all.sort());
    expect(checked.length).toBeGreaterThanOrEqual(4);

    for (const [name, reason] of Object.entries(NOT_A_POPULATION_READER)) {
      expect(all, `${name} is listed as an exception but does not exist`).toContain(name);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('narrows in SQL: every service takes its population from sources.ts', async () => {
    const files = await populationReaders();

    for (const name of files) {
      const source = await readFile(path.join(SERVICES_DIR, name), 'utf8');

      // `report-ai.service.ts` and the rest all go through the same module.
      expect(source, `${name} does not import reporting/sources`).toMatch(
        /import \* as sources from '\.\.\/reporting\/sources\.js'/,
      );

      /**
       * And every query passes a `where` built there.
       *
       * A `findAll` with no `where` at all would read the whole table and
       * narrow afterwards — the failure mode this test names.
       */
      const queries = [...source.matchAll(/\.(findAll|count|findOne)\(\{([\s\S]{0,400}?)\}\)/g)];

      for (const [, method, body] of queries) {
        // `where:` or the shorthand `where,` — both pass a clause built in
        // `sources.ts`; only the ABSENCE of one is the defect.
        expect(body, `${name}: a ${method} with no where clause`).toMatch(/where[:,\s]/);
      }
    }
  });

  it('applies a filter in the query rather than to the result', async () => {
    const period = await resolve(MONTH.from, MONTH.to);

    const all = await volumeService.report(period, parse({}));
    const emailOnly = await volumeService.report(period, parse({ channel: 'email' }));

    /**
     * The COUNT moves, not just the rows.
     *
     * Post-filtering leaves `count` and `total` describing the unfiltered
     * population — which is how a filtered report ends up quoting a number that
     * includes records it did not show. Here the filtered figure's own count is
     * smaller, because the narrowing was in the query the count came from.
     */
    expect(emailOnly.received.count).toBeLessThan(all.received.count);
    expect(emailOnly.received.value).toBe(emailOnly.received.count);
  });

  it('never returns a record an agent could not obtain directly (FR-061)', async () => {
    /**
     * An agent holds no reporting permission at all, so the sweep is a sweep of
     * refusals — and that IS the scoping decision rather than a gap in it.
     *
     * FR-061's reasoning: a team-wide aggregate lets an agent infer a
     * colleague's performance even with no per-agent breakdown. "Two breaches
     * this month" plus knowing who was on shift is a name.
     */
    for (const route of ['dashboard', 'volume', 'sla', 'csat']) {
      const response = await staffAgent.get(`/api/reports/${route}?${PERIOD}`);

      expect(response.status, route).toBe(403);
    }
  });

  it('exposes no ticket subject, customer name or message text in any figure', async () => {
    const period = await resolve(MONTH.from, MONTH.to);
    const filters = parse({});

    const volume = await volumeService.report(period, filters);
    const agents = await agentService.report(period, filters);

    const serialised = JSON.stringify({ volume, agents });

    /**
     * An aggregate report should carry counts, not content.
     *
     * The fixture's own subjects are the probe: if one appeared here, the report
     * would be handing out record content under an aggregate's authority — and
     * the caller would have obtained it without going through the ticket
     * surface that gates it.
     */
    expect(serialised).not.toContain('FEB billing dispute');
    expect(serialised).not.toContain('Acme');
  });

  it('scopes the CSAT comments, which are the one place content is returned', async () => {
    const response = await supervisor.get(`/api/reports/csat?${PERIOD}`);

    expect(response.status).toBe(200);

    /**
     * The deliberate exception, and it is bounded.
     *
     * FR-028 asks for comments, so this report does return customer-authored
     * text — but keyed by ticket REFERENCE rather than an internal id, capped,
     * and only for responses submitted inside the period. The reference is what
     * a supervisor can act on; it is also all they get.
     */
    for (const comment of response.body.comments.value) {
      expect(comment.ticketReference).toMatch(/^TKT-\d{6}$/);
      expect(comment).not.toHaveProperty('ticketId');
      expect(comment).not.toHaveProperty('customerName');
    }
  });

  it('keeps paging out of the report services entirely', async () => {
    const files = await populationReaders();

    for (const name of files) {
      const source = await readFile(path.join(SERVICES_DIR, name), 'utf8');

      /**
       * A report returns an aggregate, not a page.
       *
       * `offset` is the tell: paging over a post-filtered population is exactly
       * how page two ends up short, and it cannot happen if nothing pages. The
       * CSAT comment cap uses `limit` with no `offset`, which is a ceiling
       * rather than pagination.
       */
      expect(source, `${name} pages its results`).not.toMatch(/^\s*offset:/m);
    }
  });
});
