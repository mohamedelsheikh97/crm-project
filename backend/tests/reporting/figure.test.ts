import { describe, expect, it } from 'vitest';

import { breakdownReconciles, figure, toJson } from '../../src/reporting/figure.js';

/**
 * The figure envelope (Phase 10, research D10, FR-002 - FR-006, SC-002).
 *
 * The reconciliation test is the important one. It catches the commonest
 * arithmetic error in reporting: a total that counts nulls beside a breakdown
 * with no null bucket, so the parts sum to less than the whole — and nobody
 * notices, because nobody adds up a chart.
 */
const PERIOD = {
  from: new Date('2026-02-01T00:00:00.000Z'),
  to: new Date('2026-02-28T23:59:59.999Z'),
  timeZone: 'UTC',
};

const FILTERS = { category: null, channel: null, priority: null, agentId: null };

describe('the figure envelope', () => {
  it('attaches provenance a service cannot forget', () => {
    const result = figure({ value: 7, count: 7, total: 7 }, PERIOD, FILTERS);

    expect(result.period.timeZone).toBe('UTC');
    expect(result.filters).toEqual(FILTERS);
    expect(result.computedAt).toBeInstanceOf(Date);
    // Clarifications Q3, stated in the payload where a reader will see it.
    expect(result.reflectsCurrentState).toBe(true);
  });

  it('defaults to no exclusions and no suppression, explicitly', () => {
    const result = figure({ value: 1, count: 1, total: 1 }, PERIOD, FILTERS);

    expect(result.excluded).toEqual([]);
    expect(result.suppressed).toBe(false);
  });

  it('reconciles a breakdown that accounts for every record', () => {
    const total = figure({ value: null, count: 7, total: 7 }, PERIOD, FILTERS);
    const buckets = [{ count: 4 }, { count: 2 }, { count: 1 }];

    expect(breakdownReconciles(total, buckets)).toBe(true);
  });

  it('FAILS a breakdown that silently drops the null bucket', () => {
    // Seven records considered, six in buckets, and nothing declared excluded.
    // This is the bug the identity exists to catch: it looks complete on screen
    // because the reader does not add the buckets up.
    const total = figure({ value: null, count: 7, total: 7 }, PERIOD, FILTERS);
    const buckets = [{ count: 4 }, { count: 2 }];

    expect(breakdownReconciles(total, buckets)).toBe(false);
  });

  it('reconciles once the dropped records are DECLARED as excluded', () => {
    // The same six buckets, now honest about the seventh record (FR-004).
    const total = figure(
      { value: null, count: 6, total: 7, excluded: [{ reason: 'no_assignee', count: 1 }] },
      PERIOD,
      FILTERS,
    );

    expect(breakdownReconciles(total, [{ count: 4 }, { count: 2 }])).toBe(true);
  });

  it('serialises dates as ISO and changes nothing else', () => {
    const json = toJson(figure({ value: 3, count: 3, total: 4 }, PERIOD, FILTERS));

    expect(json.value).toBe(3);
    expect(json.count).toBe(3);
    expect(json.total).toBe(4);
    expect((json.period as { from: string }).from).toBe('2026-02-01T00:00:00.000Z');
    expect(typeof json.computedAt).toBe('string');
    expect(json.reflectsCurrentState).toBe(true);
  });
});
