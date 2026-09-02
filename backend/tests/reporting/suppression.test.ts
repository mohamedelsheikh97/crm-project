import { describe, expect, it } from 'vitest';

import { isSuppressed, rate, SUPPRESSION_FLOOR } from '../../src/reporting/suppression.js';

/**
 * The small-sample floor (Phase 10, research D12).
 *
 * Four requirements share this rule — FR-006, FR-029, FR-036 and FR-061 — and
 * they are asserted against ONE declaration rather than against each surface.
 * A test that named surfaces would miss the one added next.
 */
describe('small-sample suppression', () => {
  it('withholds a rate below the floor and permits one at it', () => {
    expect(isSuppressed(SUPPRESSION_FLOOR - 1)).toBe(true);
    expect(isSuppressed(SUPPRESSION_FLOOR)).toBe(false);
  });

  it('returns NULL rather than zero when the sample cannot support a rate', () => {
    // Zero is a claim — "nobody was satisfied". Null is an absence — "we cannot
    // say". Rendering them the same way is this phase's hazard in miniature.
    expect(rate(1, 2)).toBeNull();
    expect(rate(0, 0)).toBeNull();
  });

  it('computes a rate once the sample is large enough', () => {
    expect(rate(4, 6)).toBeCloseTo(4 / 6, 10);
    expect(rate(5, 6)).toBeCloseTo(5 / 6, 10);
  });

  it('protects an individual from being characterised by a handful of tickets', () => {
    // FR-036: four tickets is not a performance record.
    expect(rate(1, 4)).toBeNull();
  });
});
