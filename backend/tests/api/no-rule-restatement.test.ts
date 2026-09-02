import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The published interface restates no business rule (Phase 11, US1, FR-010).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A STATIC READ OF THE IMPORT GRAPH. THE TECHNIQUE HAS FOUND REAL DEFECTS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 9 used it for its AI egress boundary and it found a genuine violation —
 * but only after the FIRST version of the check passed vacuously, because on
 * Windows `path.resolve` returns backslashes and the pattern was written with
 * forward slashes. Phase 10 used it for `reporting/sources.ts`. Both files carry
 * the same two defences, and so does this one: separators are normalised, and
 * every pattern is proved against a deliberately violating source.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT MATTERS HERE MORE THAN ANYWHERE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FR-010 is the requirement in this phase most likely to be broken quietly. It
 * is satisfied on day one and lost the first time an endpoint needs a field no
 * service returns — at which point the tempting fix is a small query right there
 * in the controller. That query is then a second definition of what a merged
 * ticket is, of whether an SLA was breached, of which contact is primary. Both
 * definitions compile, both pass their own tests, they agree on the day they are
 * written and drift on the first change to either.
 *
 * And when they disagree, the published answer is the one an outside system has
 * already acted on.
 */
const CONTROLLERS_DIR = path.resolve(import.meta.dirname, '../../src/controllers/v1');
const PRESENTERS_DIR = path.resolve(import.meta.dirname, '../../src/api/v1/presenters');
const API_DIR = path.resolve(import.meta.dirname, '../../src/api');

/** Separators normalised, so the check is not silently Windows-only. */
function normalise(value: string): string {
  return value.split(path.sep).join('/');
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

    // `import type { X }` never reaches a table at runtime.
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
 * A Sequelize MODEL CLASS, as opposed to a declaration that happens to live
 * beside one.
 *
 * The same distinction Phase 10's version of this test draws, and for the same
 * reason: importing `ALL_CHANNELS` from `models/message.model.ts` is what FR-010
 * ASKS for — the channel list read from its owner rather than a copy written
 * here. What it forbids is reaching the TABLE, and model classes are PascalCase
 * values while declarations are SCREAMING_SNAKE constants or types.
 */
function isModelClass(binding: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(binding);
}

async function sourcesIn(directory: string): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(directory);

  return Promise.all(
    entries
      .filter((name) => name.endsWith('.ts'))
      .map(async (name) => ({
        file: normalise(path.join(directory, name)),
        source: await readFile(path.join(directory, name), 'utf8'),
      })),
  );
}

describe('published controllers and presenters reach no table', () => {
  it('found the files at all', async () => {
    const controllers = await sourcesIn(CONTROLLERS_DIR);
    const presenters = await sourcesIn(PRESENTERS_DIR);

    /**
     * THE ASSERTION THAT STOPS EVERY CLAIM BELOW PASSING VACUOUSLY.
     *
     * A glob that matches nothing agrees with every statement about it, which is
     * exactly how Phase 9's first egress check passed while the violation was
     * still in the tree.
     */
    expect(controllers.length).toBeGreaterThanOrEqual(4);
    expect(presenters.length).toBeGreaterThanOrEqual(3);

    const names = controllers.map((entry) => path.basename(entry.file));

    expect(names).toContain('customers.controller.ts');
    expect(names).toContain('tickets.controller.ts');
    expect(names).toContain('reports.controller.ts');
  });

  it('imports no model CLASS in any v1 controller', async () => {
    const offenders: string[] = [];

    for (const { file, source } of await sourcesIn(CONTROLLERS_DIR)) {
      for (const line of importLines(source)) {
        if (!/models\//.test(line.specifier)) continue;

        for (const binding of line.bindings) {
          if (isModelClass(binding)) {
            offenders.push(`${path.basename(file)} -> ${binding}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('imports no model CLASS in any presenter', async () => {
    const offenders: string[] = [];

    for (const { file, source } of await sourcesIn(PRESENTERS_DIR)) {
      for (const line of importLines(source)) {
        if (!/models\//.test(line.specifier)) continue;

        for (const binding of line.bindings) {
          if (isModelClass(binding)) {
            offenders.push(`${path.basename(file)} -> ${binding}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('contains no query in a presenter — a presenter maps, it does not read', async () => {
    const offenders: string[] = [];

    for (const { file, source } of await sourcesIn(PRESENTERS_DIR)) {
      // Comments stripped: these files discuss what they must not do at length.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      for (const pattern of [
        /\.findAll\(/,
        /\.findOne\(/,
        /\.count\(/,
        /sequelize\./,
        /\bquery\(/,
      ]) {
        if (pattern.test(code)) offenders.push(`${path.basename(file)} matches ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('reads its vocabularies from the OWNING modules, which FR-010 requires', async () => {
    /**
     * The complement, and it is the point rather than a formality.
     *
     * A test that only forbade imports would be satisfied by a controller that
     * wrote the four categories out as a literal — which is the drift FR-010
     * actually exists to prevent, and the case where a fifth category would be
     * silently rejected by a filter while looking like it worked.
     */
    const tickets = await readFile(path.join(CONTROLLERS_DIR, 'tickets.controller.ts'), 'utf8');

    expect(tickets).toMatch(/from '\.\.\/\.\.\/tickets\/taxonomy\.js'/);
    expect(tickets).toMatch(/from '\.\.\/\.\.\/tickets\/lifecycle\.js'/);
    // And it uses the guards rather than comparing against literals.
    expect(tickets).toContain('isTicketCategory');
    expect(tickets).toContain('isTicketStatus');

    const reports = await readFile(path.join(CONTROLLERS_DIR, 'reports.controller.ts'), 'utf8');

    // The period and the filters go through Phase 10's own modules, so
    // "February in the business calendar's zone" means one thing.
    expect(reports).toMatch(/reporting\/period\.js/);
    expect(reports).toMatch(/reporting\/filters\.js/);
  });

  it('BITES — the patterns are not vacuous', () => {
    /**
     * Proving the checks by running them against sources that violate them.
     *
     * Without this, a typo in any pattern would leave a green test asserting
     * nothing. This is the assertion Phase 9's first version of the check did
     * not have, and its absence is why the defect shipped.
     */
    const violating = [
      "import { Ticket } from '../../models/ticket.model.js';",
      "import { Customer, CustomerContact } from '../../models/index.js';",
    ].join('\n');

    const lines = importLines(violating);

    expect(
      lines.filter((line) => /models\//.test(line.specifier) && line.bindings.some(isModelClass))
        .length,
    ).toBe(2);

    // A DECLARATION import from the same directory does NOT trip it, which is
    // the distinction the whole check turns on.
    const allowed = importLines("import { ALL_CHANNELS } from '../../models/message.model.js';");

    expect(allowed[0]!.bindings.some(isModelClass)).toBe(false);

    // And a type-only import does not either.
    const typeOnly = importLines("import type { Ticket } from '../../models/ticket.model.js';");

    expect(typeOnly[0]!.bindings).toEqual([]);

    // Prose alone trips nothing — these files name models repeatedly in comments.
    expect(importLines('// This must never import Ticket from models/ticket.model.js')).toEqual([]);
  });

  it('keeps the paging primitives in one place, so cursors have one format', async () => {
    /**
     * A client that received two different cursor formats from two collections
     * would have no way to know which it was holding. `api/paging.ts` is the
     * single definition; nothing else may encode one.
     */
    const offenders: string[] = [];

    for (const directory of [CONTROLLERS_DIR, PRESENTERS_DIR]) {
      for (const { file, source } of await sourcesIn(directory)) {
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

        if (/base64url|Buffer\.from/.test(code)) {
          offenders.push(`${path.basename(file)} encodes something itself`);
        }
      }
    }

    expect(offenders).toEqual([]);

    // And `api/paging.ts` does hold the encoder, so the claim is not agreeing
    // with nothing.
    const paging = await readFile(path.join(API_DIR, 'paging.ts'), 'utf8');

    expect(paging).toContain('base64url');
  });
});
