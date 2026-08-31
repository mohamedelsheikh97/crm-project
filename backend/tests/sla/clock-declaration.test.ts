import { describe, expect, it } from 'vitest';

import {
  ACTIVE_STATUSES,
  PAUSED_STATUSES,
  RESOLVED_STATUSES,
  isActiveStatus,
  isPausedStatus,
  isResolvedStatus,
  unclassifiedStatuses,
} from '../../src/sla/clock.js';
import { TICKET_STATUSES, TRANSITIONS } from '../../src/tickets/lifecycle.js';

/**
 * FR-023, as a build failure rather than a review item.
 *
 * The clock's classification is a SECOND reading of the lifecycle, and the way
 * that goes wrong is mundane: a later phase adds a seventh status, declares its
 * edges in lifecycle.ts, and nobody remembers this file exists. The clock then
 * treats the new status as active by omission — silently charging an
 * organisation for time it was not working, with no error anywhere.
 *
 * These tests exist so that adding a status without classifying it fails here,
 * in the phase that added it.
 */
describe('the SLA clock classifies every lifecycle status (FR-023)', () => {
  it('classifies each status exactly once', () => {
    // Not "at least once": a status in two sets would make pause and resume
    // disagree about the same transition, which is worse than one omitted.
    expect(unclassifiedStatuses()).toEqual([]);
  });

  it('covers the whole lifecycle between its three sets', () => {
    const classified = [...PAUSED_STATUSES, ...RESOLVED_STATUSES, ...ACTIVE_STATUSES].sort();

    expect(classified).toEqual([...TICKET_STATUSES].sort());
  });

  it('treats pending as the only paused status (Clarifications Q1)', () => {
    // Pending means waiting on someone OUTSIDE the organisation, so the time is
    // not ours to be charged for. If a later phase adds a second such status,
    // this assertion is the conversation about whether it belongs here.
    expect(PAUSED_STATUSES).toEqual(['pending']);
    expect(isPausedStatus('pending')).toBe(true);
    expect(isPausedStatus('open')).toBe(false);
  });

  it('treats escalated as ACTIVE, not terminal', () => {
    // A breached ticket's clock must keep running: the resolution target can be
    // re-armed by a reopen, and `escalated` reaches `open`, `pending` and
    // `resolved` in the lifecycle, so it is a working state.
    expect(isActiveStatus('escalated')).toBe(true);
    expect(isResolvedStatus('escalated')).toBe(false);
    expect(TRANSITIONS.escalated.length).toBeGreaterThan(0);
  });

  it('treats resolved and closed as satisfying the resolution target', () => {
    expect(isResolvedStatus('resolved')).toBe(true);
    expect(isResolvedStatus('closed')).toBe(true);
  });
});

describe('the Phase 6 lifecycle edge (research D11)', () => {
  it('lets a breached ticket that nobody opened escalate', () => {
    // Without this edge, `new` has exactly one outgoing transition and a ticket
    // that arrived overnight and was never opened could NEVER escalate — the
    // worst-handled tickets in the system would be the only ones exempt from
    // the phase's Definition of done.
    const fromNew = TRANSITIONS.new.map((edge) => edge.to);

    expect(fromNew).toContain('escalated');
    expect(fromNew).toContain('open');
  });

  it('keeps escalation gated by tickets:transition, not by a new permission', () => {
    const edge = TRANSITIONS.new.find((candidate) => candidate.to === 'escalated');

    expect(edge?.permission).toBe('tickets:transition');
  });
});
