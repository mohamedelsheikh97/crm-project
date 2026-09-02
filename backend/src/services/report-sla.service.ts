import { Op } from 'sequelize';

import { figure, type Figure, type ResolvedPeriod } from '../reporting/figure.js';
import { describe as describeFilters, type ReportFilters } from '../reporting/filters.js';
import { bucketKey, bucketSizeFor } from '../reporting/period.js';
import * as sources from '../reporting/sources.js';
import { rate } from '../reporting/suppression.js';

/**
 * SLA performance reporting (Phase 10, US2, FR-020 - FR-025).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS SERVICE COUNTS RECORDED OUTCOMES. IT COMPUTES NOTHING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 6 anticipated this phase and left a note on the columns
 * (`ticket-sla.model.ts`):
 *
 *   "The recorded outcome Phase 10 reporting must read, not recompute."
 *
 * Taking that at its word settles four requirements at once, and the reason is
 * worth stating precisely: the report and the ticket screen read THE SAME
 * COLUMNS. So FR-025's reconciliation and SC-005's "zero differences" are not
 * tests that might fail — they are properties of there being one number rather
 * than two calculations that have to agree.
 *
 *   FR-007  do not restate another phase's rules
 *   FR-022  exclude paused time — already excluded when the outcome was written
 *   FR-025  reconcile to the per-ticket SLA state
 *   SC-005  zero reconciliation differences
 *
 * WHAT IS DELIBERATELY NOT OFFERED: average elapsed working time.
 * `lib/business-hours.ts` exports `workingTimeBetween`, and it is JavaScript
 * that walks a calendar with exceptions — there is no SQL equivalent and no
 * honest way to aggregate it in a query. The alternatives were computing it per
 * ticket (O(tickets) calendar walks per report) or approximating with
 * wall-clock time, and the second was rejected outright: it would produce a
 * figure labelled "average response time" that disagreed with every SLA target
 * in the system, and it would look entirely plausible. That is this phase's
 * central hazard in one line of SQL. See research D3 and Open Question 2.
 *
 * THIS FILE MUST NOT IMPORT `lib/business-hours.js`. A test asserts it
 * (`backend/tests/reports/sla-no-recompute.test.ts`), because the moment
 * somebody adds an elapsed-time figure by reaching for that module, the
 * guarantee above stops holding and nothing else would say so.
 */
export interface ComplianceCounts {
  readonly met: number;
  readonly breached: number;
  /** Target not yet due (FR-024) — excluded from the rate, not counted as met. */
  readonly pending: number;
}

export interface SlaReport {
  readonly responseCompliance: Figure<number | null>;
  readonly resolutionCompliance: Figure<number | null>;
  readonly byPolicy: Figure<
    Array<{ policyId: number; response: number | null; resolution: number | null; count: number }>
  >;
  readonly byPriority: Figure<
    Array<{ priority: string; response: number | null; resolution: number | null; count: number }>
  >;
  readonly overTime: Figure<
    Array<{ bucket: string; response: number | null; resolution: number | null }>
  >;
}

interface SlaRow {
  readonly ticket_id: number;
  readonly policy_id: number | null;
  readonly started_at: Date | string;
  readonly response_satisfied_at: Date | string | null;
  readonly response_breached_at: Date | string | null;
  readonly resolution_satisfied_at: Date | string | null;
  readonly resolution_breached_at: Date | string | null;
}

/**
 * Classifies one promise from its recorded columns. No arithmetic, no clock.
 *
 * BREACH WINS OVER SATISFACTION. Phase 6 writes both columns write-once, so a
 * target breached and then satisfied late has both set — and it was still
 * breached. Counting it as met would be the report disagreeing with the ticket
 * screen, which is the one thing D3 exists to prevent.
 */
function classify(
  satisfiedAt: Date | string | null,
  breachedAt: Date | string | null,
): 'met' | 'breached' | 'pending' {
  if (breachedAt !== null) return 'breached';
  if (satisfiedAt !== null) return 'met';
  return 'pending';
}

function tally(rows: readonly SlaRow[], promise: 'response' | 'resolution'): ComplianceCounts {
  let met = 0;
  let breached = 0;
  let pending = 0;

  for (const row of rows) {
    const outcome =
      promise === 'response'
        ? classify(row.response_satisfied_at, row.response_breached_at)
        : classify(row.resolution_satisfied_at, row.resolution_breached_at);

    if (outcome === 'met') met += 1;
    else if (outcome === 'breached') breached += 1;
    else pending += 1;
  }

  return { met, breached, pending };
}

/** Rate over decided promises only. A pending target is not a met one (FR-024). */
function complianceOf(counts: ComplianceCounts): number | null {
  return rate(counts.met, counts.met + counts.breached);
}

export async function report(period: ResolvedPeriod, filters: ReportFilters): Promise<SlaReport> {
  const described = describeFilters(filters);

  const rows = (await sources.models.TicketSla.findAll({
    where: sources.slaWithPolicyIn(period),
    raw: true,
  })) as unknown as SlaRow[];

  const withoutPolicy = await sources.models.TicketSla.count({
    where: sources.slaWithoutPolicyIn(period),
  });

  /**
   * The ticket-side filters (category, channel, priority, agent) apply to the
   * TICKETS the SLA rows belong to, so they are resolved by intersecting with
   * the ticket population rather than by joining — which keeps every
   * ticket-shaped predicate in `sources.ticketsCreatedIn` instead of duplicating
   * it here (research D2).
   */
  const anyTicketFilter =
    filters.category !== null ||
    filters.channel !== null ||
    filters.priority !== null ||
    filters.agentId !== null;

  /**
   * The tickets are loaded UNCONDITIONALLY, because `byPriority` needs each
   * ticket's priority whether or not a filter was requested. Only the SCOPING
   * is conditional.
   */
  const tickets = (await sources.models.Ticket.findAll({
    where: {
      id: { [Op.in]: rows.map((row) => row.ticket_id) },
      ...(anyTicketFilter
        ? (sources.ticketsCreatedIn(period, filters) as Record<string, unknown>)
        : {}),
    } as never,
    attributes: ['id', 'priority'],
    raw: true,
  })) as unknown as Array<{ id: number; priority: string }>;

  const priorityOf = new Map(tickets.map((ticket) => [ticket.id, ticket.priority]));

  const allowed = new Set(tickets.map((ticket) => ticket.id));
  const scoped = anyTicketFilter ? rows.filter((row) => allowed.has(row.ticket_id)) : rows;

  const excluded = withoutPolicy > 0 ? [{ reason: 'no_policy', count: withoutPolicy }] : [];

  const responseCounts = tally(scoped, 'response');
  const resolutionCounts = tally(scoped, 'resolution');

  const decided = (counts: ComplianceCounts) => counts.met + counts.breached;

  const build = <T>(value: T, count: number, total: number) =>
    figure({ value, count, total, excluded, suppressed: false }, period, described);

  const buildRate = (counts: ComplianceCounts) => {
    const value = complianceOf(counts);

    return figure(
      {
        value,
        count: decided(counts),
        total: decided(counts) + counts.pending + withoutPolicy,
        excluded: [
          ...excluded,
          ...(counts.pending > 0 ? [{ reason: 'not_yet_due', count: counts.pending }] : []),
        ],
        // FR-006: a rate withheld because the sample cannot support it is
        // suppressed, not shown as zero.
        suppressed: value === null && decided(counts) > 0,
      },
      period,
      described,
    );
  };

  // Per policy.
  const byPolicyMap = new Map<number, SlaRow[]>();

  for (const row of scoped) {
    if (row.policy_id === null) continue;
    byPolicyMap.set(row.policy_id, [...(byPolicyMap.get(row.policy_id) ?? []), row]);
  }

  const byPolicy = [...byPolicyMap.entries()].map(([policyId, policyRows]) => ({
    policyId,
    count: policyRows.length,
    response: complianceOf(tally(policyRows, 'response')),
    resolution: complianceOf(tally(policyRows, 'resolution')),
  }));

  // Per priority.
  const byPriorityMap = new Map<string, SlaRow[]>();

  for (const row of scoped) {
    const priority = priorityOf.get(row.ticket_id) ?? 'unknown';
    byPriorityMap.set(priority, [...(byPriorityMap.get(priority) ?? []), row]);
  }

  const byPriority = [...byPriorityMap.entries()].map(([priority, priorityRows]) => ({
    priority,
    count: priorityRows.length,
    response: complianceOf(tally(priorityRows, 'response')),
    resolution: complianceOf(tally(priorityRows, 'resolution')),
  }));

  // Over time.
  const size = bucketSizeFor(period);
  const byBucket = new Map<string, SlaRow[]>();

  for (const row of scoped) {
    const at = row.started_at instanceof Date ? row.started_at : new Date(row.started_at);
    const key = bucketKey(at, period, size);
    byBucket.set(key, [...(byBucket.get(key) ?? []), row]);
  }

  const overTime = [...byBucket.entries()]
    .map(([bucket, bucketRows]) => ({
      bucket,
      response: complianceOf(tally(bucketRows, 'response')),
      resolution: complianceOf(tally(bucketRows, 'resolution')),
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  return {
    // FR-020: SEPARATE FIGURES. Response and resolution are separate promises
    // with separate targets, and averaging them produces a number that
    // describes nothing.
    responseCompliance: buildRate(responseCounts),
    resolutionCompliance: buildRate(resolutionCounts),
    byPolicy: build(byPolicy, scoped.length, scoped.length + withoutPolicy),
    byPriority: build(byPriority, scoped.length, scoped.length + withoutPolicy),
    overTime: build(overTime, scoped.length, scoped.length + withoutPolicy),
  };
}

/** The raw counts, exposed so the reconciliation test can compare row by row. */
export async function outcomesFor(
  period: ResolvedPeriod,
): Promise<{ response: ComplianceCounts; resolution: ComplianceCounts; withoutPolicy: number }> {
  const rows = (await sources.models.TicketSla.findAll({
    where: sources.slaWithPolicyIn(period),
    raw: true,
  })) as unknown as SlaRow[];

  return {
    response: tally(rows, 'response'),
    resolution: tally(rows, 'resolution'),
    withoutPolicy: await sources.models.TicketSla.count({
      where: sources.slaWithoutPolicyIn(period),
    }),
  };
}
