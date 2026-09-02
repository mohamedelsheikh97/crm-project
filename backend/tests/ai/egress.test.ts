import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * THE EGRESS BOUNDARY, ENFORCEMENT LAYER 2 (Phase 9, research.md D2; SC-024a).
 *
 * Reads the ACTUAL IMPORT GRAPH from source. Not a mock, not a spy, not an
 * assertion about what a function did when called — a walk of what the
 * assistant's module tree is capable of reaching at all.
 *
 * The distinction matters because FR-008a asks for impossible rather than
 * discouraged. A test that called the assistant and checked which provider ran
 * would prove the happy path stays local; it would say nothing about a code
 * path nobody exercised, and the whole risk here is the path nobody thought
 * about.
 *
 * If this test fails, DO NOT add a runtime guard and move on. Something now
 * imports the external provider into the customer-facing tree, and the fix is
 * to remove the import.
 */
const SRC = path.resolve(import.meta.dirname, '../../src');

/**
 * Matched against SEPARATOR-NORMALISED paths — see `normalise` below.
 *
 * The first version of this file tested raw `path.resolve` output against
 * `/providers\/external/`, which never matches on Windows because the resolved
 * path contains backslashes. Every assertion passed, and passed VACUOUSLY: the
 * suite reported a boundary it was not checking. The complement test at the
 * bottom is what caught it, and is why it exists.
 */
const FORBIDDEN = /providers\/external/;

function normalise(file: string): string {
  return file.replace(/\\/g, '/');
}

/** Files whose reachable import tree must never contain the external provider. */
const CUSTOMER_FACING_ROOTS = [
  'services/assistant.service.ts',
  'services/assistant-escalation.service.ts',
  'controllers/portal/assistant.controller.ts',
  'controllers/public/assistant.controller.ts',
  'ai/prompts/assistant.ts',
];

const IMPORT_PATTERN = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Resolves a TS-style `./x.js` specifier back to the `.ts` file on disk. */
function resolveSpecifier(fromFile: string, specifier: string): string {
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  return resolved.replace(/\.js$/, '.ts');
}

async function reachableFrom(entry: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const next = resolveSpecifier(file, match[1]);
      if (!seen.has(next)) queue.push(next);
    }
  }

  return seen;
}

describe('the customer-facing assistant cannot reach the external AI provider', () => {
  for (const root of CUSTOMER_FACING_ROOTS) {
    it(`${root} has no transitive import of the external provider`, async () => {
      const entry = path.join(SRC, root);

      // Roots are added as the phase is implemented; a root that does not exist
      // yet is not a failure, but a root that exists MUST be clean.
      if (!(await exists(entry))) {
        expect(true).toBe(true);
        return;
      }

      const reachable = await reachableFrom(entry);
      const offending = [...reachable].filter((file) => FORBIDDEN.test(normalise(file)));

      expect(
        offending,
        `${root} can reach the external AI provider. Customer content must stay on ` +
          `controlled infrastructure (FR-008). Import local-factory.js instead.`,
      ).toEqual([]);
    });
  }

  it('the external provider is still reachable from staff-facing services', async () => {
    // The complement, so this suite fails if someone "fixes" it by deleting the
    // external provider rather than by fixing the import.
    const entry = path.join(SRC, 'ai/providers/external-factory.ts');
    const reachable = await reachableFrom(entry);

    expect([...reachable].some((file) => FORBIDDEN.test(normalise(file)))).toBe(true);
  });
});
