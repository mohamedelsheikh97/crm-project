import { Op, type WhereOptions } from 'sequelize';

import { AiCategoryProposal } from '../models/ai-category-proposal.model.js';
import { AiInvocation } from '../models/ai-invocation.model.js';
import { Ticket } from '../models/ticket.model.js';
import { TicketSatisfaction } from '../models/ticket-satisfaction.model.js';
import { TicketSla } from '../models/ticket-sla.model.js';
import { User } from '../models/user.model.js';

import type { ResolvedPeriod } from './figure.js';
import type { ReportFilters } from './filters.js';

/**
 * THE ONLY MODULE IN THIS PHASE PERMITTED TO NAME A TABLE OWNED BY ANOTHER
 * PHASE (Phase 10, research D2, FR-007, SC-025).
 *
 * Reporting is the first thing in this codebase that legitimately reads across
 * every phase, and that coupling cannot be removed — an SLA compliance figure
 * genuinely needs `ticket_sla`, `tickets`, `business_calendars` and `users`
 * together. What it CAN be is reviewable.
 *
 * Concentrating every foreign reference here means SC-025's verification —
 * that SLA state, working hours and the ticket lifecycle are read from their
 * owning modules rather than restated — is a ONE-FILE READ rather than a search
 * across six services. `routes/public/index.ts` and `portal/endpoints.ts`
 * already provide that property for their own concerns and say so in their own
 * comments; this is the same technique on a different axis.
 *
 * It is also the single place a Phase 12 department predicate will need to land.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE MUST NEVER DO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Decide anything. It builds `where` clauses and exposes models; it does not
 * classify a status, compute a working hour, or judge whether an SLA was met.
 * Those belong to:
 *
 *   ticket statuses, transitions  → tickets/lifecycle.ts
 *   categories, priorities        → tickets/taxonomy.ts
 *   which statuses pause an SLA   → sla/clock.ts
 *   working-hour arithmetic       → lib/business-hours.ts
 *   whether an SLA was met        → ticket_sla's RECORDED columns (research D3)
 *   customer-facing ticket state  → portal/customer-status.ts
 *
 * A reporting query that computed SLA state itself would become a second
 * definition of Phase 6's rules. Both would compile, both would pass their own
 * tests, they would agree on the day they were written and drift on the first
 * change to either — and when they disagreed, the report would be the wrong one
 * and nothing would say so.
 */

/** The models reporting may read. Exposed so no service imports one directly. */
export const models = {
  Ticket,
  TicketSla,
  TicketSatisfaction,
  User,
  AiInvocation,
  AiCategoryProposal,
} as const;

/**
 * Tickets CREATED inside the period, with the request's filters applied.
 *
 * This is the "received" population (FR-016) and it is deliberately distinct
 * from `ticketsOpenAt` below — they answer different questions and are commonly
 * confused, which is why the volume report reports both rather than one figure
 * called "tickets".
 */
export function ticketsCreatedIn(period: ResolvedPeriod, filters: ReportFilters): WhereOptions {
  const where: Record<string, unknown> = {
    created_at: { [Op.between]: [period.from, period.to] },
  };

  if (filters.category) where.category = filters.category;
  if (filters.channel) where.source = filters.channel;
  if (filters.priority) where.priority = filters.priority;
  if (filters.agentId) where.assignee_user_id = filters.agentId;

  // FR-017: a merged ticket is counted ONCE, on the surviving side. Excluding
  // the absorbed row here is what makes that true — counting both would
  // double-count the work and counting neither would lose it.
  where.merged_into_ticket_id = null;

  return where as WhereOptions;
}

/**
 * Tickets that existed and were not settled at the END of the period.
 *
 * Note what this does NOT filter on: `created_at` between the bounds. A ticket
 * raised in March and still open in May is open at the end of May, and a query
 * that filtered by creation date would miss it — reporting "open tickets" as
 * "tickets created this month that are still open", which is a different and
 * much smaller number.
 */
export function ticketsOpenAt(
  period: ResolvedPeriod,
  filters: ReportFilters,
  unsettledStatuses: readonly string[],
): WhereOptions {
  const where: Record<string, unknown> = {
    created_at: { [Op.lte]: period.to },
    status: { [Op.in]: unsettledStatuses },
    merged_into_ticket_id: null,
  };

  if (filters.category) where.category = filters.category;
  if (filters.channel) where.source = filters.channel;
  if (filters.priority) where.priority = filters.priority;
  if (filters.agentId) where.assignee_user_id = filters.agentId;

  return where as WhereOptions;
}

/**
 * SLA rows for tickets whose clock STARTED in the period.
 *
 * Keyed on `started_at` rather than the ticket's creation date because Phase 6
 * restarts the clock on a reopen (its FR-030) — so an SLA outcome belongs to the
 * period its promise was made in, which is the question a compliance report is
 * actually asking.
 */
export function slaStartedIn(period: ResolvedPeriod): WhereOptions {
  return {
    started_at: { [Op.between]: [period.from, period.to] },
  } as WhereOptions;
}

/**
 * SLA rows in the period that HAVE a policy — the compliance population.
 *
 * FR-023: a ticket with no policy was never promised anything, so counting it
 * as compliant would inflate every rate. It is excluded here and counted
 * separately by `slaWithoutPolicyIn` so the figure can report the exclusion
 * rather than being quietly narrower than the table (FR-004).
 */
export function slaWithPolicyIn(period: ResolvedPeriod): WhereOptions {
  return {
    started_at: { [Op.between]: [period.from, period.to] },
    policy_id: { [Op.not]: null },
  } as WhereOptions;
}

/** What `slaWithPolicyIn` left out, so the exclusion can be stated. */
export function slaWithoutPolicyIn(period: ResolvedPeriod): WhereOptions {
  return {
    started_at: { [Op.between]: [period.from, period.to] },
    policy_id: null,
  } as WhereOptions;
}

/**
 * Tickets that COULD have been rated — the CSAT response-rate denominator
 * (Phase 10, FR-027).
 *
 * The population is settled tickets, because a survey is only offered once
 * there is an outcome to rate. `settledStatuses` is passed in rather than
 * written here: which statuses mean "finished" is Phase 6's decision
 * (`sla/clock.ts`'s `RESOLVED_STATUSES`), and a second list here would drift
 * from it on the first change to either.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. A response rate whose denominator is the
 * number of responses is always 100%. The tickets that were never rated are
 * exactly the ones the figure exists to count, and they are also the ones a
 * naive query silently omits — because they have no row in
 * `ticket_satisfaction` at all.
 */
export function rateableIn(
  period: ResolvedPeriod,
  filters: ReportFilters,
  settledStatuses: readonly string[],
): WhereOptions {
  const where: Record<string, unknown> = {
    created_at: { [Op.between]: [period.from, period.to] },
    status: { [Op.in]: settledStatuses },
    merged_into_ticket_id: null,
  };

  if (filters.category) where.category = filters.category;
  if (filters.channel) where.source = filters.channel;
  if (filters.priority) where.priority = filters.priority;
  if (filters.agentId) where.assignee_user_id = filters.agentId;

  return where as WhereOptions;
}

/** Satisfaction responses submitted in the period. */
export function satisfactionIn(period: ResolvedPeriod): WhereOptions {
  return {
    submitted_at: { [Op.between]: [period.from, period.to] },
  } as WhereOptions;
}

/**
 * SLA rows for tickets currently assigned to a given agent (Phase 10, FR-031).
 *
 * Two-step rather than a join, and deliberately: `ticket_sla` has no assignee
 * column, and attribution is by the ticket's CURRENT assignee (research D4).
 * Passing the ticket ids in means the attribution rule is applied in ONE place —
 * the agent service's ticket query — instead of once here and once there, which
 * is how two definitions of "whose ticket is this" get created.
 */
export function slaForTickets(period: ResolvedPeriod, ticketIds: readonly number[]): WhereOptions {
  return {
    started_at: { [Op.between]: [period.from, period.to] },
    policy_id: { [Op.not]: null },
    ticket_id: { [Op.in]: ticketIds.length > 0 ? ticketIds : [0] },
  } as WhereOptions;
}

/**
 * Every user who may appear in the agent report, INCLUDING THE DEACTIVATED.
 *
 * FR-033: a deactivated agent's historical work stays reportable for the
 * periods they worked in. Filtering to `is_active` would silently remove a
 * leaver's tickets from every past month — and the totals would still look
 * plausible, because the tickets are counted in the report's own denominator
 * from `tickets` rather than from this list.
 *
 * `created_at` comes back because FR-032 needs the period an agent was
 * actually active: a low count in the month somebody joined is not performance.
 * That is the only date the schema has for this, and FR-035 forbids adding new
 * monitoring of staff to get a better one — so the report states what it knows
 * rather than implying more.
 */
export function reportableUsers(userIds: readonly number[]): WhereOptions {
  return {
    id: { [Op.in]: userIds.length > 0 ? userIds : [0] },
  } as WhereOptions;
}

/** AI invocations in the period. Metadata only — Phase 9 keeps no content. */
export function invocationsIn(period: ResolvedPeriod): WhereOptions {
  return {
    created_at: { [Op.between]: [period.from, period.to] },
  } as WhereOptions;
}

/** Category proposals created in the period, for the acceptance rate (FR-056). */
export function proposalsIn(period: ResolvedPeriod): WhereOptions {
  return {
    created_at: { [Op.between]: [period.from, period.to] },
  } as WhereOptions;
}

/**
 * The MERGED side of any pair created in the period.
 *
 * `ticketsCreatedIn` excludes these so a merged pair counts once (FR-017). This
 * counts what was excluded, so the figure can report it rather than being
 * quietly smaller than the table (FR-004).
 */
export function mergedIn(period: ResolvedPeriod, filters: ReportFilters): WhereOptions {
  const where: Record<string, unknown> = {
    created_at: { [Op.between]: [period.from, period.to] },
    merged_into_ticket_id: { [Op.not]: null },
  };

  if (filters.category) where.category = filters.category;
  if (filters.channel) where.source = filters.channel;
  if (filters.priority) where.priority = filters.priority;
  if (filters.agentId) where.assignee_user_id = filters.agentId;

  return where as WhereOptions;
}

/**
 * Any ticket at all on or before the period's end.
 *
 * FR-014 needs this to tell "a quiet month" from "the system held no data yet".
 * Reporting zero for a period before the system existed is a claim, and a false
 * one — and it is the kind a manager acts on.
 */
export function anyTicketUpTo(period: ResolvedPeriod): WhereOptions {
  return { created_at: { [Op.lte]: period.to } } as WhereOptions;
}
