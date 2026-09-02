/**
 * The small-sample floor, declared ONCE (Phase 10, research D12).
 *
 * Four requirements want this rule, and without one declaration they would be
 * implemented three or four times with three or four different numbers:
 *
 *   FR-006  no figure with more precision than its sample supports
 *   FR-029  no CSAT average presented as reliable over a handful of responses
 *   FR-036  no individual characterised by a handful of tickets
 *   FR-061  no identification of a record by aggregating over a small group
 *
 * They are the SAME RULE with different motivations. One declaration is what
 * makes SC-011 and SC-014 testable by iterating the surfaces rather than by
 * naming each one — and a test that names surfaces misses the one added next.
 *
 * THE NUMBER IS OPEN QUESTION 3. Too high and a small team sees nothing but
 * withheld figures, which reads as missing data; too low and one bad week
 * characterises an agent, which reads as insight. It cannot be chosen well
 * before somebody looks at real distributions, which is why it lives in one
 * place — the lesson Phase 9 recorded twice, for its grounding floor and its
 * classification confidence threshold.
 */
export const SUPPRESSION_FLOOR = 5;

/**
 * Whether a figure over this many records may be presented as a rate.
 *
 * Returns the SUPPRESSION decision, not the rate — so a caller cannot
 * accidentally use the boolean as a value.
 */
export function isSuppressed(count: number): boolean {
  return count < SUPPRESSION_FLOOR;
}

/**
 * A rate, or null where the sample cannot support one.
 *
 * Returning `null` rather than `0` is deliberate: zero is a claim ("nobody was
 * satisfied") and null is an absence ("we cannot say"). Rendering them the same
 * way is the phase's hazard in miniature.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0 || isSuppressed(denominator)) return null;

  return numerator / denominator;
}
