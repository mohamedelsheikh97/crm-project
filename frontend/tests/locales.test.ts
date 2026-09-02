import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import ar from '../src/locales/ar.json';
import en from '../src/locales/en.json';

/**
 * SC-017, as an assertion rather than a review item.
 *
 * Principle I is the project's first non-negotiable, and the way it actually
 * fails is mundane: someone adds an English string, ships, and an Arabic user
 * sees a raw key. Nothing in a code review reliably catches that — a build does.
 *
 * These tests exist so a one-sided key fails here rather than in production, in
 * a language the reviewer probably does not read.
 */
describe('locale files stay in step (SC-017)', () => {
  const enKeys = Object.keys(en).sort();
  const arKeys = Object.keys(ar).sort();

  it('hold identical key sets', () => {
    expect(enKeys.filter((key) => !arKeys.includes(key))).toEqual([]);
    expect(arKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  it('have no empty values in either language', () => {
    // A key present but blank is the same defect wearing a disguise: the screen
    // renders nothing where a label belongs.
    const blank = (messages: Record<string, string>): string[] =>
      Object.entries(messages)
        .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
        .map(([key]) => key);

    expect(blank(en as Record<string, string>)).toEqual([]);
    expect(blank(ar as Record<string, string>)).toEqual([]);
  });

  it('use the same interpolation placeholders in both languages', () => {
    // A translation that drops `{reference}` renders a sentence with a hole in
    // it, which reads as a bug to the user and passes every other check.
    //
    // COMPARED AS A SET, NOT A LIST, and Phase 6 is what forced the
    // distinction. Arabic has SIX plural categories to English's two, so a
    // pluralised message legitimately repeats `{value}` six times in one file
    // and twice in the other. Counting occurrences would fail every correctly
    // translated plural — which is the opposite of what this test is for. What
    // matters is that no NAMED placeholder is missing.
    const placeholders = (value: string): string[] =>
      [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

    const mismatched: string[] = [];

    for (const key of enKeys) {
      const english = placeholders((en as Record<string, string>)[key]);
      const arabic = placeholders((ar as Record<string, string>)[key]);

      if (JSON.stringify(english) !== JSON.stringify(arabic)) mismatched.push(key);
    }

    expect(mismatched).toEqual([]);
  });
});

/**
 * The other half of the same problem: a key that is USED but never defined.
 * The parity test above cannot see it, because it is absent from both files.
 */
describe('every literal translation key used in the app exists', () => {
  function sourceFiles(directory: string): string[] {
    const found: string[] = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);

      if (entry.isDirectory()) found.push(...sourceFiles(full));
      else if (/\.(vue|ts)$/.test(entry.name)) found.push(full);
    }

    return found;
  }

  it("resolves every $t('...') and t('...') call", () => {
    const known = new Set(Object.keys(en));
    const missing: string[] = [];

    for (const file of sourceFiles(path.resolve(import.meta.dirname, '../src'))) {
      const source = fs.readFileSync(file, 'utf8');

      // The lookbehind matters: without it, `params.set('page', …)` matches,
      // because "set(" ends in "t(". It must be a call to `t` or `$t`, not a
      // call to something whose name happens to end in one.
      for (const match of source.matchAll(/(?<![\w.])(?:\$t|t)\(\s*'([a-zA-Z][\w.]*)'/g)) {
        if (!known.has(match[1])) missing.push(`${match[1]} (${path.basename(file)})`);
      }
    }

    // Dynamic keys — `$t(\`ticket.status.${status}\`)` — are deliberately not
    // checked here: their coverage comes from the component tests that render
    // every value of the enumeration.
    expect(missing).toEqual([]);
  });
});

/**
 * Every message must actually COMPILE.
 *
 * This exists because of a real defect, and a nasty one to diagnose. vue-i18n
 * treats `@` as the start of a linked message (`@:some.key`), so a message
 * containing a bare `@` throws `SyntaxError: Message compilation error:
 * Invalid linked format` — but NOT at startup. It throws lazily, the first time
 * that particular message is rendered.
 *
 * `ticketNote.placeholder` was "Type @ to mention a colleague." The throw
 * happened inside the note composer's render, during a route change, and the
 * visible symptom was nothing like the cause: the URL changed and the screen
 * did not, because a render that throws mid-navigation leaves the previous view
 * mounted. Nobody would guess a placeholder string from that.
 *
 * Compiling every message here turns a lazy runtime crash into a build failure,
 * for `@`, for stray `|`, and for malformed `{...}` alike.
 */
describe('every message compiles (vue-i18n)', () => {
  for (const [locale, messages] of [
    ['en', en],
    ['ar', ar],
  ] as const) {
    it(`compiles every ${locale} message`, () => {
      const i18n = createI18n({
        legacy: false,
        locale,
        fallbackLocale: locale,
        messages: { [locale]: messages } as Record<string, Record<string, string>>,
        // Silence "missing parameter" noise: this test is about COMPILATION,
        // and a message with an unsupplied {placeholder} still compiles.
        warnHtmlMessage: false,
        missingWarn: false,
        fallbackWarn: false,
      });

      const broken: string[] = [];

      for (const key of Object.keys(messages)) {
        try {
          i18n.global.t(key);
        } catch (error) {
          broken.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      expect(broken).toEqual([]);
    });
  }
});

/**
 * Phase 9 namespaces, asserted explicitly (T116, FR-058, FR-061).
 *
 * The suite above already proves the two files hold identical key sets, so this
 * is not a second parity check. It asserts the namespaces EXIST — that a phase
 * which added surfaces in both realms actually externalised their text, in both
 * languages, rather than shipping a hardcoded English string that the parity
 * test cannot see because it is absent from both files.
 */
describe('Phase 9 externalised its interface text', () => {
  const NAMESPACES = ['ai.', 'ai.admin.', 'portal.assistant.'];

  for (const namespace of NAMESPACES) {
    it(`has ${namespace}* keys in both languages`, () => {
      const inEn = Object.keys(en).filter((key) => key.startsWith(namespace));
      const inAr = Object.keys(ar).filter((key) => key.startsWith(namespace));

      expect(inEn.length).toBeGreaterThan(0);
      expect(inAr.sort()).toEqual(inEn.sort());
    });
  }

  it('translates the AI disclosure rather than leaving it English (FR-059)', () => {
    // The one string on every AI surface. An English disclosure on an Arabic
    // page is the specific failure SC-026 exists to catch, and it is the kind
    // that survives review by anyone who does not read Arabic.
    expect(ar['ai.disclosure.label']).toBeTruthy();
    expect(ar['ai.disclosure.label']).not.toBe(en['ai.disclosure.label']);
  });
});

/**
 * Phase 10 namespaces, asserted explicitly (T098, FR-063, SC-029).
 *
 * The parity suite above already proves the two files hold identical key sets,
 * so this is not a second parity check. It asserts the namespaces EXIST — that a
 * phase which put numbers, chart labels and withheld-figure notices on screen
 * actually externalised them, in both languages, rather than shipping a
 * hardcoded English string that parity cannot see because it is absent from
 * both files.
 *
 * A chart is the easiest place in a codebase to leave an English axis label: it
 * is short, it looks like data rather than copy, and nobody reviewing a diff of
 * SVG reads it as text.
 */
describe('Phase 10 externalised its reporting text', () => {
  const NAMESPACES = [
    'reports.',
    'reports.figure.',
    'reports.column.',
    'reports.excluded.',
    'reports.export.',
    'reports.csat.',
    'reports.agent.',
    'reports.arrangement.',
  ];

  for (const namespace of NAMESPACES) {
    it(`has ${namespace}* keys in both languages`, () => {
      const inEn = Object.keys(en).filter((key) => key.startsWith(namespace));
      const inAr = Object.keys(ar).filter((key) => key.startsWith(namespace));

      expect(inEn.length).toBeGreaterThan(0);
      expect(inAr.sort()).toEqual(inEn.sort());
    });
  }

  it('translates the current-state disclosure rather than leaving it English', () => {
    /**
     * Clarifications Q3's disclosure, which is the one string that explains why
     * last month's report changed since it was last read. An English sentence
     * there on an Arabic screen leaves the reader with an unexplained
     * discrepancy — the exact failure the disclosure exists to prevent.
     */
    expect(ar['reports.figure.currentState']).toBeTruthy();
    expect(ar['reports.figure.currentState']).not.toBe(en['reports.figure.currentState']);
  });

  it('translates the withheld-figure notice, which stands in for a number', () => {
    // Where a rate is suppressed this text IS the figure. Left in English it
    // reads as a rendering fault rather than as a deliberate withholding.
    expect(ar['reports.figure.withheld']).toBeTruthy();
    expect(ar['reports.figure.withheld']).not.toBe(en['reports.figure.withheld']);
  });

  it('translates every exclusion reason, so an Arabic reader learns WHY', () => {
    const reasons = Object.keys(en).filter((key) => key.startsWith('reports.excluded.'));

    expect(reasons.length).toBeGreaterThan(0);

    for (const reason of reasons) {
      // FR-004 requires the exclusion stated. An untranslated statement of it
      // is a statement the Arabic reader cannot use.
      expect((ar as Record<string, string>)[reason], `${reason} is not translated`).not.toBe(
        (en as Record<string, string>)[reason],
      );
    }
  });

  it('names every dashboard figure key the arrangement picker can offer', () => {
    /**
     * The picker renders `reports.figure.name.<key>`. A missing entry there
     * shows a raw dotted key in a checkbox list — and the literal-key test above
     * cannot catch it, because the lookup is dynamic.
     *
     * The catalog is read from the backend source rather than duplicated, so a
     * figure added later fails here instead of shipping unlabelled.
     */
    const catalog = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../backend/src/reporting/figures.ts'),
      'utf8',
    );

    const block = catalog.slice(
      catalog.indexOf('export const FIGURE_CATALOG'),
      catalog.indexOf('} as const satisfies'),
    );

    const keys = [...block.matchAll(/'([\w.]+)':\s*'[\w:]+'/g)].map((match) => match[1]);

    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect(Object.keys(en), `reports.figure.name.${key}`).toContain(`reports.figure.name.${key}`);
      expect(Object.keys(ar), `reports.figure.name.${key}`).toContain(`reports.figure.name.${key}`);
    }
  });
});
