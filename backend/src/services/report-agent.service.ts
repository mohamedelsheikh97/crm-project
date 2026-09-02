import { figure, type Figure, type ResolvedPeriod } from '../reporting/figure.js';
import { describe as describeFilters, type ReportFilters } from '../reporting/filters.js';
import * as sources from '../reporting/sources.js';
import { isSuppressed, rate } from '../reporting/suppression.js';
import { RESOLVED_STATUSES } from '../sla/clock.js';

/**
 * Agent performance reporting (Phase 10, US5, FR-030 - FR-036).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SUBJECT OF THIS REPORT CANNOT SEE IT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Clarifications Q1 restricted it to supervisors and administrators, and
 * FR-030b puts it out of an agent's reach on every surface. That decision
 * changes what the rest of this file owes:
 *
 *   - The attribution rule is a RESPONSE FIELD (FR-031), not a footnote in a
 *     component. The agent being described cannot ask what the number means, so
 *     the number has to carry its own definition to whoever can.
 *   - Traceability matters MORE, not less (FR-034). A disputed figure can only
 *     be settled by opening the tickets it counted, and the agent cannot do that
 *     for themselves — the supervisor must be able to do it on their behalf.
 *   - The suppression floor is not a nicety (FR-036). "50% resolution" over two
 *     tickets is a sentence about a person who has no way to answer it.
 *
 * ATTRIBUTION IS BY CURRENT ASSIGNEE (research D4), which is Open Question 1 and
 * the one question in this phase whose wrong answer affects somebody's
 * appraisal. It is stated rather than assumed, in the payload, so a decision to
 * change it becomes a visible change rather than a silent one.
 */

/**
 * The rule, as a machine-readable key plus its consequences.
 *
 * A key rather than a sentence, so the surface renders it in the reader's
 * language (FR-063) — but the consequences are enumerated because they are the
 * part somebody will get wrong when reimplementing this: the ticket counts
 * ONCE, for whoever holds it now, and a reassignment moves the whole ticket
 * rather than splitting it.
 */
export const ATTRIBUTION_RULE = {
  key: 'current_assignee',
  countsOnce: true,
  /** Open Question 1. Recorded so a change to it is a change to this constant. */
  openQuestion: 'attribution at resolution rather than current assignee is unresolved',
} as const;

export interface AgentRow {
  readonly agentId: number;
  readonly name: string;
  /** FR-033: a leaver's historical work stays reportable. */
  readonly active: boolean;
  /**
   * FR-032: the period the agent was actually available.
   *
   * `activeFrom` is the account's creation date, which is the only date the
   * schema records for this. `activeTo` is null even for a deactivated agent,
   * because nothing records WHEN they were deactivated and FR-035 forbids
   * adding new monitoring of staff to find out. Stating the gap is better than
   * implying a precision that does not exist.
   */
  readonly activeFrom: Date;
  readonly activeTo: null;
  readonly assigned: number;
  readonly settled: number;
  /** null below the floor, never 0 — see `suppression.ts`. */
  readonly settledRate: number | null;
  readonly responseCompliance: number | null;
  readonly resolutionCompliance: number | null;
  /** True when this row's rates are withheld for sample size (FR-036). */
  readonly suppressed: boolean;
}

export interface AgentReport {
  readonly attributionRule: typeof ATTRIBUTION_RULE;
  readonly agents: Figure<AgentRow[]>;
}

interface TicketRow {
  readonly id: number;
  readonly assignee_user_id: number | null;
  readonly status: string;
}

interface SlaRow {
  readonly ticket_id: number;
  readonly response_satisfied_at: Date | string | null;
  readonly response_breached_at: Date | string | null;
  readonly resolution_satisfied_at: Date | string | null;
  readonly resolution_breached_at: Date | string | null;
}

/**
 * Classifies one recorded promise. Identical to the SLA report's rule and for
 * the same reason: BREACH WINS, because Phase 6 writes both columns write-once
 * and a target breached then satisfied late was still breached (research D3).
 *
 * No clock, no arithmetic, no `lib/business-hours` — the columns are read as
 * recorded, so this report cannot disagree with the ticket screen.
 */
function decided(
  satisfiedAt: Date | string | null,
  breachedAt: Date | string | null,
): 'met' | 'breached' | null {
  if (breachedAt !== null) return 'breached';
  if (satisfiedAt !== null) return 'met';
  return null;
}

export async function report(period: ResolvedPeriod, filters: ReportFilters): Promise<AgentReport> {
  const described = describeFilters(filters);

  /**
   * ONE PASS OVER THE TICKETS, and the attribution rule applied HERE only.
   *
   * `assignee_user_id` is the current assignee. Every downstream figure is
   * grouped from this list rather than from its own query, so exactly one place
   * decides whose ticket a ticket is — the property FR-031's "never counts one
   * ticket for two agents" depends on.
   */
  const tickets = (await sources.models.Ticket.findAll({
    where: sources.ticketsCreatedIn(period, filters),
    attributes: ['id', 'assignee_user_id', 'status'],
    raw: true,
  })) as unknown as TicketRow[];

  const byAgent = new Map<number, TicketRow[]>();
  let unassigned = 0;

  for (const ticket of tickets) {
    if (ticket.assignee_user_id === null) {
      unassigned += 1;
      continue;
    }

    const existing = byAgent.get(ticket.assignee_user_id);

    if (existing) existing.push(ticket);
    else byAgent.set(ticket.assignee_user_id, [ticket]);
  }

  /**
   * SLA rows for the whole population, fetched once and indexed.
   *
   * Per-agent queries would be N+1 and would also invite a second attribution
   * decision inside the loop. Indexing by ticket id keeps the grouping above
   * the only place attribution happens.
   */
  const slaRows = (await sources.models.TicketSla.findAll({
    where: sources.slaForTickets(
      period,
      tickets.map((ticket) => ticket.id),
    ),
    attributes: [
      'ticket_id',
      'response_satisfied_at',
      'response_breached_at',
      'resolution_satisfied_at',
      'resolution_breached_at',
    ],
    raw: true,
  })) as unknown as SlaRow[];

  const slaByTicket = new Map<number, SlaRow>();

  for (const row of slaRows) slaByTicket.set(row.ticket_id, row);

  const users = (await sources.models.User.findAll({
    where: sources.reportableUsers([...byAgent.keys()]),
    attributes: ['id', 'full_name', 'is_active', 'created_at'],
    raw: true,
  })) as unknown as Array<{
    id: number;
    full_name: string;
    is_active: boolean | number;
    created_at: Date | string;
  }>;

  const rows: AgentRow[] = [];

  for (const user of users) {
    const assignedTickets = byAgent.get(user.id) ?? [];
    const settled = assignedTickets.filter((ticket) =>
      (RESOLVED_STATUSES as readonly string[]).includes(ticket.status),
    ).length;

    let responseMet = 0;
    let responseDecided = 0;
    let resolutionMet = 0;
    let resolutionDecided = 0;

    for (const ticket of assignedTickets) {
      const sla = slaByTicket.get(ticket.id);

      if (!sla) continue;

      const response = decided(sla.response_satisfied_at, sla.response_breached_at);
      const resolution = decided(sla.resolution_satisfied_at, sla.resolution_breached_at);

      if (response !== null) {
        responseDecided += 1;
        if (response === 'met') responseMet += 1;
      }

      if (resolution !== null) {
        resolutionDecided += 1;
        if (resolution === 'met') resolutionMet += 1;
      }
    }

    rows.push({
      agentId: user.id,
      name: user.full_name,
      active: Boolean(user.is_active),
      activeFrom: user.created_at instanceof Date ? user.created_at : new Date(user.created_at),
      activeTo: null,
      /**
       * COUNTS ARE NEVER SUPPRESSED. "3 tickets" is a fact; "33% resolved" over
       * three tickets is a characterisation of a person. The floor governs
       * rates only, which is why `rate()` returns null and the counts do not.
       */
      assigned: assignedTickets.length,
      settled,
      settledRate: rate(settled, assignedTickets.length),
      responseCompliance: rate(responseMet, responseDecided),
      resolutionCompliance: rate(resolutionMet, resolutionDecided),
      suppressed: isSuppressed(assignedTickets.length),
    });
  }

  /**
   * BY NAME, NOT BY ANY FIGURE.
   *
   * Ordering by performance would make this a ranking — a different artefact,
   * with different consequences for somebody who cannot see it — and
   * Clarifications Q1's access decision does not extend to publishing one.
   */
  rows.sort((left, right) => left.name.localeCompare(right.name));

  const attributed = rows.reduce((sum, row) => sum + row.assigned, 0);

  return {
    attributionRule: ATTRIBUTION_RULE,
    agents: figure(
      {
        value: rows,
        count: attributed,
        total: attributed + unassigned,
        /**
         * FR-004: the unassigned tickets are why this breakdown does not sum to
         * the volume report's total. Stated, so the difference is explained
         * rather than looking like a missing agent.
         */
        excluded: unassigned > 0 ? [{ reason: 'no_assignee', count: unassigned }] : [],
      },
      period,
      described,
    ),
  };
}
