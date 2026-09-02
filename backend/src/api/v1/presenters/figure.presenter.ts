import type { Figure } from '../../../reporting/figure.js';

/**
 * Phase 10's figure envelope → the published shape (Phase 11, FR-012, SC-007).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY FIELD SURVIVES THE TRIP. THAT IS THE REQUIREMENT, NOT A COURTESY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 10 spent a whole phase establishing that a number is not trustworthy on
 * its own, and encoded six honesty requirements as REQUIRED fields on one type
 * so a service could not forget them. Dropping any of them here would undo that
 * work on the one surface where the reader cannot see the screen:
 *
 *   `count` / `total`  — a rate without its denominator reads identically at
 *                        2-of-3 and 6,700-of-10,000
 *   `excluded`         — a figure narrower than the table is explained rather
 *                        than merely smaller
 *   `suppressed`       — below the floor the VALUE IS NULL, never 0
 *   `period` + zone    — the figure means nothing without what it covers
 *   `computed_at`      — the last SUCCESSFUL computation
 *   `reflects_current_state` — recategorising a ticket today changes last
 *                        month's report, and a client storing these figures
 *                        must store this flag with them
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `null` IS NOT `0`, AND A CLIENT MUST BE ABLE TO TELL.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Zero is a claim — "nobody was satisfied", "nothing was breached". `null` is an
 * absence — "this sample cannot support a rate". Phase 10's `suppression.ts`
 * returns `null` rather than `0` for exactly this reason, and serialising it as
 * `0` here would reintroduce the problem the floor exists to prevent, in the
 * place where nobody is watching.
 *
 * JSON carries `null` natively, so this costs nothing. What it needs is for the
 * presenter not to "helpfully" default it.
 */

export interface PublishedFigure {
  readonly value: unknown;
  readonly count: number;
  readonly total: number;
  readonly excluded: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
  readonly suppressed: boolean;
  readonly period: {
    readonly from: string;
    readonly to: string;
    readonly time_zone: string;
  };
  readonly filters: Readonly<Record<string, string | number | null>>;
  readonly computed_at: string;
  readonly reflects_current_state: boolean;
}

export function figure(source: Figure<unknown>): PublishedFigure {
  return {
    // NOT `?? 0`, NOT `?? null` with a fallback elsewhere. Whatever the service
    // decided, including null, travels unchanged.
    value: source.value,
    count: source.count,
    total: source.total,
    excluded: source.excluded.map((entry) => ({ reason: entry.reason, count: entry.count })),
    suppressed: source.suppressed,
    period: {
      from: source.period.from.toISOString(),
      to: source.period.to.toISOString(),
      time_zone: source.period.timeZone,
    },
    filters: source.filters,
    computed_at: source.computedAt.toISOString(),
    reflects_current_state: source.reflectsCurrentState,
  };
}

/** Maps a whole report's figures, so a controller cannot present one and forget another. */
export function figures<K extends string>(
  source: Readonly<Record<K, Figure<unknown>>>,
): Record<K, PublishedFigure> {
  const out = {} as Record<K, PublishedFigure>;

  for (const key of Object.keys(source) as K[]) {
    out[key] = figure(source[key]);
  }

  return out;
}
