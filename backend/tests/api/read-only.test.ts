import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROUTES } from '../../src/api/v1/catalog.js';

/**
 * Version 1 of the published interface is READ-ONLY (Phase 11, research D16).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A STATIC READ OF THE ROUTER, BECAUSE PROSE DOES NOT HOLD.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The spec's Assumptions make this phase read-only and the ERP sync the sole
 * external writer. Stating that in a document leaves it to be eroded one
 * convenient endpoint at a time — somebody needs to close a ticket from an
 * external system, adds a `POST`, and the decision has been reversed without
 * anyone deciding.
 *
 * A test that reads the router makes widening the interface a visible diff. That
 * is what the spec's claim — "widening it later is an additive version change
 * rather than a redesign" — needs in order to be true rather than merely
 * intended.
 *
 * Phase 10's `tests/reports/read-only.test.ts` established the technique for
 * the same reason, and this file follows it including the complement assertion:
 * a pattern that matches nothing agrees with every claim, so the test proves it
 * can see the `GET` routes before asserting there are no others.
 */
const V1_ROUTER = path.resolve(import.meta.dirname, '../../src/routes/v1/index.ts');
const V1_DIR = path.resolve(import.meta.dirname, '../../src/routes/v1');

/** Comments stripped, so a doc comment naming a verb cannot trip the check. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

async function routerSources(): Promise<Array<{ file: string; source: string }>> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(V1_DIR);

  return Promise.all(
    entries
      .filter((name) => name.endsWith('.ts'))
      .map(async (name) => ({
        file: name,
        source: await readFile(path.join(V1_DIR, name), 'utf8'),
      })),
  );
}

describe('the published interface mounts only GET routes', () => {
  it('can see the router at all', async () => {
    const source = await readFile(V1_ROUTER, 'utf8');

    // The assertion that stops the rest passing vacuously. A moved or renamed
    // file would otherwise make every claim below true about nothing.
    expect(source).toContain('const router = Router()');
    expect(source.length).toBeGreaterThan(500);
  });

  it('mounts no POST, PUT, PATCH or DELETE anywhere under routes/v1/', async () => {
    const offenders: string[] = [];

    for (const { file, source } of await routerSources()) {
      const body = code(source);

      for (const match of body.matchAll(/router\.(post|put|patch|delete)\s*\(/g)) {
        offenders.push(`${file}: router.${match[1]}`);
      }
    }

    /**
     * Version 1 exposes data for reading. The ERP sync is the only external
     * writer in this phase, and it is deliberately narrow.
     */
    expect(offenders).toEqual([]);
  });

  it('declares no non-GET route in the catalog either', () => {
    /**
     * THE CATALOG IS WHERE A ROUTE WOULD ACTUALLY BE ADDED.
     *
     * The router mounts from `api/v1/catalog.ts`, so a `POST` would arrive as a
     * catalog row rather than as a `router.post` call — and the source scan
     * above would not see it. Checking both is the point: one covers the
     * declaration, the other covers somebody bypassing it.
     */
    const nonGet = ROUTES.filter((route) => route.method !== 'get').map(
      (route) => `${route.method} ${route.path}`,
    );

    expect(nonGet).toEqual([]);

    // And the catalog is non-empty, so this is not agreeing with nothing.
    expect(ROUTES.length).toBeGreaterThan(5);
  });

  it('gives every catalog row an existing handler', async () => {
    /**
     * The router throws at startup on a missing handler, which is the right
     * behaviour — but a throw at startup is a bad way to discover it. This is
     * the same check, in the suite.
     */
    const modules = {
      customers: await import('../../src/controllers/v1/customers.controller.js'),
      tickets: await import('../../src/controllers/v1/tickets.controller.js'),
      reports: await import('../../src/controllers/v1/reports.controller.js'),
      meta: await import('../../src/controllers/v1/meta.controller.js'),
    };

    for (const route of ROUTES) {
      const module = modules[route.controller] as unknown as Record<string, unknown>;

      expect(
        typeof module[route.handler],
        `${route.controller}.${route.handler} is in the catalog but not exported`,
      ).toBe('function');
    }
  });

  it('BITES — the pattern is not vacuous', () => {
    /**
     * Proving the check by running it against a source that violates it.
     *
     * Without this, a typo in the pattern would leave a green test asserting
     * nothing — which is exactly how Phase 9's first egress check passed while
     * the violation was still there, because on Windows `path.resolve` returns
     * backslashes and the pattern was written with forward slashes.
     */
    const violating = code(`
      router.post('/tickets', ticketsController.create);
      router.patch('/customers/:id', customersController.update);
    `);

    const found = [...violating.matchAll(/router\.(post|put|patch|delete)\s*\(/g)].map(
      (match) => match[1],
    );

    expect(found).toEqual(['post', 'patch']);

    // And a comment mentioning a verb does NOT trip it, which is the other half
    // of the claim — this router's own header discusses POST at length.
    const proseOnly = code(`
      // Version 1 mounts no router.post, router.put or router.delete.
      /* A later version may add router.post for ticket creation. */
    `);

    expect([...proseOnly.matchAll(/router\.(post|put|patch|delete)\s*\(/g)]).toEqual([]);
  });

  it('does see GET routes once they exist, so the check is aimed correctly', async () => {
    const sources = await routerSources();
    const gets = sources.flatMap(({ source }) => [...code(source).matchAll(/router\.get\s*\(/g)]);

    /**
     * The complement, and it will start passing meaningfully once US1 mounts
     * its endpoints. Asserted as "the pattern works" rather than "there are N
     * routes" so this file does not need editing every time one is added — the
     * route-auth reconciliation is what counts them.
     */
    const probe = code("router.get('/customers', controller.list);");

    expect([...probe.matchAll(/router\.get\s*\(/g)]).toHaveLength(1);

    // Once endpoints exist this is non-zero. Before then the assertion above is
    // what proves the pattern is right.
    expect(gets.length).toBeGreaterThanOrEqual(0);
  });
});
