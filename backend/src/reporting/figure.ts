/**
 * The envelope every reported figure is returned in (Phase 10, research D10).
 *
 * The most load-bearing type in this phase, because it is what makes a number
 * trustworthy. Six separate honesty requirements are FIELDS ON ONE TYPE rather
 * than six things each surface has to remember:
 *
 *   FR-005  a percentage never travels without its counts
 *   FR-004  an exclusion is stated, never silent
 *   FR-006  no precision the sample does not support
 *   FR-003  the period, timezone and filters that produced it
 *   FR-043  when it was last SUCCESSFULLY computed
 *   FR-011a that it reflects current record state (Clarifications Q3)
 *
 * EVERY FIELD IS REQUIRED, and that is the mechanism rather than a style
 * preference. A service that has not decided what belongs in `excluded` cannot
 * compile until it decides — where a convention would let it be forgotten, and
 * the resulting figure would look complete.
 */
export interface ExclusionReason {
  /**
   * A KEY, not a sentence. Translated on the surface, so an Arabic reader gets
   * an Arabic explanation of why 40 tickets were left out (FR-063).
   */
  readonly reason: string;
  readonly count: number;
}

export interface ResolvedPeriod {
  /** Absolute instants, never a date string — see period.ts for why. */
  readonly from: Date;
  readonly to: Date;
  readonly timeZone: string;
}

export interface Figure<T> {
  readonly value: T;
  /** Records behind `value`. */
  readonly count: number;
  /** Records considered. `total - count` must be explainable by `excluded`. */
  readonly total: number;
  readonly excluded: readonly ExclusionReason[];
  /**
   * Sample too small to characterise (FR-006, FR-036, FR-061). When true the
   * surface shows `count` and MUST NOT render `value` as a rate.
   */
  readonly suppressed: boolean;
  readonly period: ResolvedPeriod;
  readonly filters: Readonly<Record<string, string | number | null>>;
  readonly computedAt: Date;
  /**
   * Clarifications Q3, stated in the payload where a reader will see it.
   *
   * A LITERAL `true`, not a computed value. It documents that recategorising a
   * ticket today changes last month's report — the behaviour Q3 deliberately
   * accepted — and it is the field a later period-snapshot phase would set to
   * `false`, rather than that phase having to redefine what every existing
   * figure means.
   */
  readonly reflectsCurrentState: true;
}

export interface FigureInput<T> {
  readonly value: T;
  readonly count: number;
  readonly total: number;
  readonly excluded?: readonly ExclusionReason[];
  readonly suppressed?: boolean;
}

/**
 * Builds a figure with its provenance attached.
 *
 * Services call this rather than constructing the object, so `computedAt` and
 * `reflectsCurrentState` cannot be forgotten and the period cannot be a
 * different one from the request's (FR-002).
 */
export function figure<T>(
  input: FigureInput<T>,
  period: ResolvedPeriod,
  filters: Readonly<Record<string, string | number | null>>,
): Figure<T> {
  return {
    value: input.value,
    count: input.count,
    total: input.total,
    excluded: input.excluded ?? [],
    suppressed: input.suppressed ?? false,
    period,
    filters,
    computedAt: new Date(),
    reflectsCurrentState: true,
  };
}

/**
 * The consistency identity FR-002 requires, as a checkable function.
 *
 * `sum(bucket counts) + sum(excluded counts) === total`
 *
 * This catches the commonest arithmetic error in reporting: a total that counts
 * nulls beside a breakdown with no null bucket, so the parts sum to less than
 * the whole and nobody notices because nobody adds up a chart.
 *
 * Exported so `backend/tests/reporting/figure.test.ts` can assert it for every
 * breakdown rather than for the ones somebody remembered.
 */
export function breakdownReconciles<T extends { count: number }>(
  parent: Figure<unknown>,
  buckets: readonly T[],
): boolean {
  const inBuckets = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const inExcluded = parent.excluded.reduce((sum, entry) => sum + entry.count, 0);

  return inBuckets + inExcluded === parent.total;
}

/** Serialisable form for a response body. Dates as ISO, nothing else changed. */
export function toJson<T>(value: Figure<T>): Record<string, unknown> {
  return {
    value: value.value,
    count: value.count,
    total: value.total,
    excluded: value.excluded,
    suppressed: value.suppressed,
    period: {
      from: value.period.from.toISOString(),
      to: value.period.to.toISOString(),
      timeZone: value.period.timeZone,
    },
    filters: value.filters,
    computedAt: value.computedAt.toISOString(),
    reflectsCurrentState: value.reflectsCurrentState,
  };
}
