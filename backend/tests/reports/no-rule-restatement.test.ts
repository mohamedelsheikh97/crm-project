import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No report restates another phase's rules (Phase 10, FR-007, SC-025).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A STATIC READ OF THE IMPORT GRAPH, AND THE TECHNIQUE CAUGHT A REAL DEFECT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 9 used the same approach for its egress boundary, and it found a genuine
 * violation — but only after a first version of the check passed VACUOUSLY,
 * because on Windows `path.resolve` returns backslashes and the pattern was
 * written with forward slashes. So this file normalises separators, asserts the
 * scan actually found files, and every pattern is anchored to an import LINE
 * rather than matched anywhere in the source (a doc comment explaining a
 * prohibition must not satisfy the check for it).
 *
 * WHY IT MATTERS HERE. Reporting is the first thing in this codebase that
 * legitimately reads across every phase. A compliance query that computed SLA
 * state itself would become a second definition of Phase 6's rules: both would
 * compile, both would pass their own tests, they would agree on the day they
 * were written and drift on the first change to either — and when they
 * disagreed, the report would be the wrong one and nothing would say so.
 *
 * `reporting/sources.ts` is the ONE file permitted to name another phase's
 * table, which makes SC-025's verification a one-file read.
 */
const SERVICES_DIR = path.resolve(import.meta.dirname, '../../src/services');
const REPORTING_DIR = path.resolve(import.meta.dirname, '../../src/reporting');

/** Backslashes normalised, so the check is not silently Windows-only. */
function normalise(value: string): string {
  return value.split(path.sep).join('/');
}

/** Import specifiers only — a mention in prose must not satisfy the check. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1]!);
}

interface ImportLine {
  readonly specifier: string;
  /** Value bindings only; `import type` and inline `type X` are dropped. */
  readonly bindings: readonly string[];
}

function importLines(source: string): ImportLine[] {
  const lines: ImportLine[] = [];

  for (const match of source.matchAll(/^\s*import\s+([^;]*?)\s+from\s+'([^']+)'/gm)) {
    const clause = match[1]!;
    const specifier = match[2]!;

    // `import type { X } from` never reaches a table at runtime.
    if (/^type\s/.test(clause)) {
      lines.push({ specifier, bindings: [] });
      continue;
    }

    const braced = /\{([^}]*)\}/.exec(clause);
    const inside = braced ? braced[1]! : clause;

    const bindings = inside
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '' && !/^type\s/.test(entry))
      .map((entry) => entry.split(/\s+as\s+/)[0]!.trim())
      .filter((entry) => entry !== '' && entry !== '*');

    lines.push({ specifier, bindings });
  }

  return lines;
}

/**
 * A Sequelize MODEL CLASS, as opposed to a declaration that happens to live in
 * the same file.
 *
 * The distinction is the requirement rather than a convenience. FR-007 forbids
 * restating another phase's rules — so importing `ALL_CHANNELS` from
 * `models/message.model.ts` is precisely what it ASKS for: the channel list read
 * from its owner instead of a fifth copy written out here, which would silently
 * omit a channel added later while every total still looked plausible.
 *
 * What FR-007 forbids is reaching the TABLE: a model class, whose `findAll` is a
 * query nobody reviewed against `sources.ts`. Model classes are PascalCase
 * values; declarations are SCREAMING_SNAKE constants or types.
 */
function isModelClass(binding: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(binding);
}

async function reportServices(): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(SERVICES_DIR);
  const files = entries.filter((name) => /^report-.*\.service\.ts$/.test(name));

  return Promise.all(
    files.map(async (name) => ({
      file: normalise(path.join(SERVICES_DIR, name)),
      source: await readFile(path.join(SERVICES_DIR, name), 'utf8'),
    })),
  );
}

describe('report services reach other phases only through reporting/sources.ts', () => {
  it('found the report services at all', async () => {
    const services = await reportServices();

    // The assertion that stops this whole file passing vacuously. A glob that
    // matches nothing agrees with every claim below.
    expect(services.length).toBeGreaterThanOrEqual(4);

    const names = services.map((service) => path.basename(service.file));

    expect(names).toContain('report-volume.service.ts');
    expect(names).toContain('report-sla.service.ts');
    expect(names).toContain('report-csat.service.ts');
    expect(names).toContain('report-agent.service.ts');
  });

  it('imports no model CLASS directly — only sources.ts may hold a query', async () => {
    const services = await reportServices();
    const offenders: string[] = [];

    for (const service of services) {
      for (const line of importLines(service.source)) {
        if (!/models\//.test(line.specifier)) continue;

        for (const binding of line.bindings) {
          // `sources.ts` exposes the models reporting may read. A service
          // reaching past it is a service that can add a table nobody reviewed.
          if (isModelClass(binding)) {
            offenders.push(`${path.basename(service.file)} -> ${binding}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('DOES read declarations from their owning module, which FR-007 requires', async () => {
    const volume = await readFile(path.join(SERVICES_DIR, 'report-volume.service.ts'), 'utf8');

    const declarations = importLines(volume)
      .flatMap((line) => line.bindings)
      .filter((binding) => /^[A-Z][A-Z0-9_]+$/.test(binding));

    /**
     * The complement, and it is the point rather than a formality.
     *
     * A test that only forbade imports would be satisfied by a service that
     * wrote the four categories out as a literal — which is the drift FR-007
     * actually exists to prevent, and the one where a fifth category would be
     * silently omitted from every chart.
     */
    expect(declarations).toContain('TICKET_CATEGORIES');
    expect(declarations).toContain('TICKET_STATUSES');
    expect(declarations).toContain('ALL_CHANNELS');
  });

  it('never imports the working-hours module', async () => {
    const services = await reportServices();
    const offenders: string[] = [];

    for (const service of services) {
      for (const specifier of importsOf(service.source)) {
        /**
         * The specific drift research D3 warns about.
         *
         * The moment somebody adds an average-elapsed figure by reaching for
         * `lib/business-hours.ts`, this phase starts recomputing what Phase 6
         * already decided — and the report and the ticket screen can then
         * disagree about whether an SLA was met. That is Open Question 2, and
         * it is not answered by importing the module quietly.
         *
         * Matched on the import LINE: `report-sla.service.ts` names this module
         * in a doc comment explaining the prohibition, and a naive
         * `source.includes()` would be satisfied by that comment.
         */
        if (/business-hours/.test(specifier)) {
          offenders.push(`${path.basename(service.file)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('BITES — the patterns are not vacuous', async () => {
    /**
     * Proving the checks above by running them against sources that violate
     * them. Without this, a typo in either pattern would leave a green test
     * asserting nothing — which is exactly how the Phase 9 version of this
     * check first passed while the violation was still there.
     */
    const violating = [
      "import { Ticket } from '../models/ticket.model.js';",
      "import { workingMinutesBetween } from '../lib/business-hours.js';",
    ].join('\n');

    const lines = importLines(violating);

    expect(
      lines.some((line) => /models\//.test(line.specifier) && line.bindings.some(isModelClass)),
    ).toBe(true);
    expect(lines.some((line) => /business-hours/.test(line.specifier))).toBe(true);

    // And a DECLARATION import from the same directory does not trip it, which
    // is the distinction the check turns on.
    const allowed = importLines("import { ALL_CHANNELS } from '../models/message.model.js';");

    expect(allowed[0]!.bindings.some(isModelClass)).toBe(false);

    // And prose alone does NOT trip them, which is the other half of the claim.
    const proseOnly = '// This file must never import lib/business-hours or a model directly.';

    expect(importsOf(proseOnly)).toEqual([]);
  });

  it('keeps sources.ts as the only file naming another phase’s tables', async () => {
    const entries = await readdir(REPORTING_DIR);
    const offenders: string[] = [];

    for (const name of entries.filter((entry) => entry.endsWith('.ts'))) {
      if (name === 'sources.ts') continue;

      const source = await readFile(path.join(REPORTING_DIR, name), 'utf8');

      for (const line of importLines(source)) {
        if (!/models\//.test(line.specifier)) continue;

        for (const binding of line.bindings) {
          if (isModelClass(binding)) offenders.push(`${name} -> ${binding}`);
        }
      }
    }

    // The property that makes the review a one-file read: every foreign
    // reference is concentrated in `sources.ts`, so verifying SC-025 does not
    // mean searching six services.
    expect(offenders).toEqual([]);
  });

  it('has sources.ts actually importing the models, so the concentration is real', async () => {
    const source = await readFile(path.join(REPORTING_DIR, 'sources.ts'), 'utf8');
    const classes = importLines(source)
      .filter((line) => /models\//.test(line.specifier))
      .flatMap((line) => line.bindings)
      .filter(isModelClass);

    // The complement again. If `sources.ts` imported no model class, every
    // assertion above would hold and reporting would be reading tables some
    // other way entirely.
    expect(classes.length).toBeGreaterThan(3);
    expect(classes).toContain('Ticket');
    expect(classes).toContain('TicketSla');
  });
});
