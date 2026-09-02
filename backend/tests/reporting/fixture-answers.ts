/**
 * The fixture's answers, COMPUTED BY HAND (Phase 10, research D9, SC-001).
 *
 * Every literal below was counted from `fixture.ts` by reading it, not derived
 * from a query. That is the entire point: the spec's Assumptions section forbids
 * verifying a report against a second query, because **two queries that agree
 * can both be wrong** — they share assumptions about null handling, boundary
 * inclusiveness and merge behaviour, and those assumptions are exactly where the
 * bug will be.
 *
 * Writing the answers by hand forced a decision on each awkward case. The
 * workings are shown so a reviewer can check the arithmetic rather than trust
 * it, and so that a future disagreement between this file and the implementation
 * means one of them is wrong — rather than that both drifted together.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE WORKINGS — February 2026
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Tickets created 2026-02-01 .. 2026-02-28, merged side excluded:
 *
 *   1. billing dispute        Feb 3   billing    email   agentA   open
 *   2. technical fault        Feb 10  technical  email   agentB   open
 *   3. unassigned complaint   Feb 12  complaint  email   (none)   open
 *   4. portal request         Feb 18  general    portal  agentA   open
 *   5. opened/closed in March Feb 26  general    email   agentA   closed
 *   6. resolved and rated     Feb 5   general    email   agentA   resolved
 *   7. resolved, never rated  Feb 6   general    email   agentA   resolved
 *
 *   RECEIVED = 7.  The merged duplicate (also Feb 3) is counted ZERO times
 *   (FR-017), so it is 7 and not 8.
 *
 * By category: billing 1, technical 1, complaint 1, general 4  →  sums to 7 ✓
 * By channel:  email 6, portal 1                               →  sums to 7 ✓
 *
 * OPEN AT END OF FEBRUARY — current status unsettled, created on or before
 * Feb 28, merged side excluded:
 *
 *   JAN technical question   (open)
 *   JAN still open in Feb    (open)     ← the row a created_at filter would miss
 *   billing dispute          (open)
 *   technical fault          (open)
 *   unassigned complaint     (open)
 *   portal request           (open)
 *
 *   OPEN AT END = 6.
 *
 *   Note 7 ≠ 6. That inequality is the point of FR-016 — "received" and "open"
 *   answer different questions, and a fixture where they coincided would let a
 *   report conflate them and still pass.
 *
 *   The `opened/closed in March` ticket is NOT counted, because its CURRENT
 *   status is closed. It WAS open on Feb 28. This is Clarifications Q3's
 *   accepted cost, made concrete: the same February report run in February and
 *   in April gives 7 and 6.
 *
 * SLA — rows whose clock started in February:
 *
 *   billing dispute        response MET      resolution MET
 *   resolved and rated     response BREACH   resolution MET
 *   resolved, never rated  response BREACH   resolution BREACH
 *   technical fault        response MET      resolution MET
 *   unassigned complaint   response MET      resolution MET
 *   opened/closed in March response MET      resolution MET
 *   portal request         NO POLICY  → excluded (FR-023)
 *
 *   With a policy: 6.  Excluded: 1.
 *   Response   MET 4, BREACH 2  →  4/6
 *   Resolution MET 5, BREACH 1  →  5/6
 *
 *   6 clears the suppression floor of 5, so these are real rates rather than
 *   the small-sample path.
 *
 * CSAT — responses submitted in February: ONE, score 4.
 *
 *   Distribution: { 4: 1 }.
 *   Average: 4 — but n=1 is below the floor, so the average is SUPPRESSED
 *   (FR-029). The figure carries the count and withholds the rate.
 *
 *   Response rate denominator = tickets that reached a settled state and could
 *   have been rated: resolved+rated, resolved+unrated, opened/closed = 3.
 *   Numerator 1. Also below the floor, so also suppressed — which is the
 *   honest outcome for one response and exactly what FR-029 asks for.
 *
 * AGENTS — attribution by CURRENT assignee (research D4):
 *
 *   agentA: billing, portal, opened/closed, rated, unrated = 5
 *   agentB: technical fault                                = 1
 *   unassigned                                             = 1
 *   5 + 1 + 1 = 7 ✓  — the unassigned ticket is why the breakdown needs an
 *   exclusion to reconcile to the total (FR-004).
 */

export const FEBRUARY = {
  /** Tickets created in the month, merged side counted once (FR-016, FR-017). */
  received: 7,

  /** Unsettled by CURRENT status, created on or before the period end. */
  openAtEnd: 6,

  byCategory: { billing: 1, technical: 1, complaint: 1, general: 4 },
  byChannel: { email: 6, portal: 1 },

  /** Statuses of the 7 received tickets, by current value. */
  byStatus: { open: 4, closed: 1, resolved: 2 },

  sla: {
    withPolicy: 6,
    excludedNoPolicy: 1,
    responseMet: 4,
    responseBreached: 2,
    resolutionMet: 5,
    resolutionBreached: 1,
    /** 4/6 and 5/6 — above the floor, so real rates. */
    responseCompliance: 4 / 6,
    resolutionCompliance: 5 / 6,
  },

  csat: {
    responses: 1,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 },
    /** n=1 is below the suppression floor: the average is withheld (FR-029). */
    averageSuppressed: true,
    /** Settled tickets that could have been rated (FR-027). */
    rateableTickets: 3,
    responseRateSuppressed: true,
  },

  agents: {
    /** By CURRENT assignee (research D4). */
    agentA: 5,
    agentB: 1,
    unassigned: 1,
  },
} as const;

/**
 * The fixture's instants are UTC, so the hand-computed answers only hold if the
 * active business calendar's timezone is UTC. A test asserts this rather than
 * assuming it — otherwise a machine in another zone would shift every boundary
 * and every number above would be wrong for a reason nobody would look for.
 */
export const REQUIRED_TIME_ZONE = 'UTC';
