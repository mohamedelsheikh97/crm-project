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
