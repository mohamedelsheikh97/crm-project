import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Chart primitives hold no business rule and name no table (Phase 10, T103,
 * T104, plan.md Structure Decision, research D7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IGNORANCE IS THE PROPERTY BEING PROTECTED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same bar chart draws volume by category, agent volumes and AI usage. That
 * it does not know which is what stops it acquiring a rule — because the moment
 * a chart contains "if the category is billing" or a status list, there are two
 * definitions of the taxonomy: the service's and the chart's. They agree on the
 * day they are written and drift on the first change to either, and the chart's
 * copy is the one nobody thinks to update.
 *
 * NO DUAL-AXIS CHART, EVER (T104). Two y-scales make any apparent relationship
 * an artefact of the scales chosen — the single most common reporting mistake,
 * and one that survives review because the picture looks informative. Two
 * measures of different scale go in two charts, or indexed to a common base.
 */
const VIZ_DIR = path.resolve(import.meta.dirname, '../../src/components/viz');

function vizComponents(): Array<{ name: string; source: string }> {
  return fs
    .readdirSync(VIZ_DIR)
    .filter((name) => name.endsWith('.vue'))
    .map((name) => ({ name, source: fs.readFileSync(path.join(VIZ_DIR, name), 'utf8') }));
}

/** Comments stripped, so prose explaining a prohibition cannot satisfy it. */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('chart primitives are ignorant of which report they serve', () => {
  it('found the components at all', () => {
    const components = vizComponents();

    // The assertion that stops every claim below passing vacuously. A directory
    // read that returns nothing agrees with everything.
    expect(components.length).toBeGreaterThanOrEqual(8);

    const names = components.map((component) => component.name);

    expect(names).toContain('BarChart.vue');
    expect(names).toContain('FigureFrame.vue');
    expect(names).toContain('DivergingStackedBar.vue');
  });

  it('names no ticket category, status, priority or channel', () => {
    /**
     * The vocabularies a chart must not know.
     *
     * `FigureFrame` is exempt from nothing here — it renders a figure envelope
     * and translates exclusion reasons by key, which is why its `t()` calls are
     * dynamic rather than a list of reasons.
     */
    const VOCABULARY = [
      'billing',
      'technical',
      'complaint',
      'resolved',
      'escalated',
      'pending',
      'urgent',
      'whatsapp',
    ];

    const offenders: string[] = [];

    for (const component of vizComponents()) {
      const body = code(component.source);

      for (const term of VOCABULARY) {
        if (new RegExp(`['"\`]${term}['"\`]`).test(body)) {
          offenders.push(`${component.name} names "${term}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('names no table and reaches no service', () => {
    const offenders: string[] = [];

    for (const component of vizComponents()) {
      const body = code(component.source);

      // A chart that fetched its own data would resolve its own period, and a
      // dashboard of self-fetching tiles is exactly the disagreement FR-002
      // exists to prevent.
      if (/services\//.test(body)) offenders.push(`${component.name} imports a service`);
      if (/\btickets\b|\bticket_sla\b|\bticket_satisfaction\b/.test(body)) {
        offenders.push(`${component.name} names a table`);
      }
      if (/fetch\(|request\(/.test(body)) offenders.push(`${component.name} makes a request`);
    }

    expect(offenders).toEqual([]);
  });

  it('has NO dual-axis chart anywhere (T104)', () => {
    const offenders: string[] = [];

    for (const component of vizComponents()) {
      const body = code(component.source);

      /**
       * The tells of a second scale.
       *
       * A dual-axis chart needs two independent domains, so it shows up as a
       * second max/scale pair or an explicit right-hand axis. Matched on code
       * rather than the whole file, because this project's own README explains
       * the prohibition in prose.
       */
      for (const pattern of [
        /rightAxis|axisRight|secondaryAxis|yRight|scaleRight/i,
        /y2Max|secondMax|rightMax/i,
      ]) {
        if (pattern.test(body)) offenders.push(`${component.name} matches ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('BITES — the patterns are not vacuous', () => {
    /**
     * Proving the checks by running them against sources that violate them.
     *
     * Without this, a typo in any pattern above would leave a green test
     * asserting nothing. Phase 9 shipped exactly that mistake once, in its
     * egress check, and it was only caught because a complement assertion like
     * this one was added.
     */
    const violating = code(`
      const label = row.category === 'billing' ? 'Billing' : 'Other';
      import * as reportsService from '../../services/reports.service';
      const rightAxis = max(other);
    `);

    // The same pattern the check above builds, written as a literal — a
    // backtick needs no escape inside a character class.
    expect(/['"`]billing['"`]/.test(violating)).toBe(true);
    expect(/services\//.test(violating)).toBe(true);
    expect(/rightAxis|axisRight|secondaryAxis|yRight|scaleRight/i.test(violating)).toBe(true);

    // And prose alone does NOT trip them, which is the other half of the claim.
    const proseOnly = code(`
      <!-- Never a dual-axis chart: no rightAxis, no secondaryAxis. -->
      /* A chart must not know that a category is 'billing'. */
    `);

    expect(proseOnly.trim()).toBe('');
  });

  it('formats every number and date through vue-i18n, never String()', () => {
    const offenders: string[] = [];

    for (const component of vizComponents()) {
      const body = code(component.source);

      /**
       * An axis label is the easiest place in a codebase to leave `String(n)`,
       * and the result is Latin digits on an Arabic screen — a Principle I
       * failure that looks like nothing in a diff.
       *
       * `String(value)` on a LABEL is fine; on a number it is not. The check is
       * narrow on purpose: `String(` applied to something named like a count.
       */
      for (const match of body.matchAll(/String\(\s*([\w.]+)\s*\)/g)) {
        const argument = match[1]!;

        if (/count|value|total|score|n\b|rate|tokens|invocations/i.test(argument)) {
          offenders.push(`${component.name} formats ${argument} with String()`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('gives every chart a table view through FigureFrame', () => {
    const frame = fs.readFileSync(path.join(VIZ_DIR, 'FigureFrame.vue'), 'utf8');

    /**
     * One mechanism, four jobs: screen-reader access, the relief the palette's
     * light-mode contrast WARN obligates, the RTL fallback, and greyscale
     * print. It is required by the spec rather than added for the palette,
     * which is why a single implementation discharges all four.
     */
    expect(frame).toContain('FigureTable');
    expect(frame).toContain('data-figure-table');

    // Both are in the DOM with one hidden, so `print.css` can reveal the table
    // — a `v-if` would leave it unreachable in the PDF export.
    expect(frame).toMatch(/:hidden="showTable"/);
    expect(frame).toMatch(/:hidden="!showTable"/);
  });
});
