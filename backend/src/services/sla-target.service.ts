import type { Transaction } from 'sequelize';

import { addWorkingMinutes, workingTimeBetween } from '../lib/business-hours.js';
import { now as clockNow } from '../lib/clock.js';
import { Ticket, TicketSla } from '../models/index.js';
import type { TicketStatus } from '../tickets/lifecycle.js';
import { isPausedStatus, isResolvedStatus } from '../sla/clock.js';
import * as calendarService from './calendar.service.js';
import * as policyService from './sla-policy.service.js';
import * as historyService from './ticket-history.service.js';

/**
 * THE CLOCK: computing, recomputing, pausing, resuming, and satisfying targets
 * (Phase 6, FR-010-FR-032).
 *
 * TARGETS ARE STORED, NOT COMPUTED ON READ (FR-029). Every function here writes
 * an absolute time at a real event — creation, a priority change, a pause, a
 * resume, a reopen — and nothing recomputes on a read. That is what makes an
 * edit to the business calendar move FUTURE targets only, rather than silently
 * rewriting commitments already made.
 *
 * PAUSING REWRITES THE TARGET; IT DOES NOT ACCUMULATE AN OFFSET (research D3).
 * At pause we store what was LEFT; at resume the target becomes "now plus what
 * was left". FR-022's "excluded exactly once" is then structural: there is no
 * accumulated quantity to double-count, and no read has to know the calendar.
 *
 * The obvious alternative — accumulate `paused_ms` and subtract at read — is
 * wrong in a way that is easy to miss: it has to subtract WORKING time, not
 * wall-clock, or a weekend spent paused is deducted twice, once by the calendar
 * and once by the offset.
 */

const MS_PER_MINUTE = 60_000;

/**
 * Attach targets to a ticket that has none (FR-010).
 *
 * A ticket matching NO policy gets NO ROW — not a row of nulls. FR-014 is
 * structural here: there is no state in which a ticket without a commitment can
 * be reported as breaching one.
 */
export async function attachTargets(
  ticket: Ticket,
  transaction: Transaction,
  startedAt: Date = clockNow(),
): Promise<TicketSla | null> {
  const policy = await policyService.matchFor({
    priority: ticket.priority,
    category: ticket.category,
  });

  if (!policy) return null;

  const calendar = await calendarService.workingCalendar();

  const responseTarget = addWorkingMinutes(startedAt, policy.response_minutes, calendar);
  const resolutionTarget = addWorkingMinutes(startedAt, policy.resolution_minutes, calendar);

  const row = await TicketSla.create(
    {
      ticket_id: ticket.id,
      policy_id: policy.id,
      started_at: startedAt,
      response_target_at: responseTarget,
      resolution_target_at: resolutionTarget,
    },
    { transaction },
  );

  // `tickets.due_source` DEFAULTS TO `manual`, and that default is right for
  // the backfill — every ticket that existed before Phase 6 had its date typed
  // by a person (FR-024c). It is wrong for a ticket acquiring its FIRST
  // commitment here, where by definition nobody has typed anything: ticket
  // creation does not accept a due date, so a null one means "unclaimed", not
  // "a person chose none".
  //
  // Claiming it for the policy only when it is null keeps FR-024a intact — a
  // date somebody did set is never taken over by this path.
  //
  // `== null` rather than `=== null` ON PURPOSE: a freshly created instance
  // returns `undefined` for a column that was never assigned, and only a
  // reloaded one returns `null`. A strict check here silently leaves every new
  // ticket's date unclaimed, which is a bug that shows up as "the policy
  // computed a target and the due date stayed empty".
  if (ticket.due_at == null) {
    ticket.due_source = 'policy';
  }

  await mirrorDueDate(ticket, resolutionTarget, transaction);

  await historyService.record(
    {
      ticketId: ticket.id,
      event: historyService.TICKET_EVENTS.SLA_TARGET_SET,
      actor: historyService.SYSTEM_ACTOR,
      field: 'slaResolutionTarget',
      previousValue: null,
      newValue: resolutionTarget.toISOString(),
    },
    transaction,
  );

  return row;
}

/**
 * THE PHASE 4 SEAM (FR-024, research D6).
 *
 * The resolution target populates `tickets.due_at` — but ONLY while
 * `due_source` is `policy`. A date a person set is a commitment they made,
 * usually one agreed with a customer, and no policy evaluation may overwrite
 * it (FR-024a).
 *
 * Everything downstream — the queue sort, the overdue filter, the overdue
 * indicator, the approaching-due warning — reads `due_at` and is untouched by
 * this phase, which is exactly what Phase 4's FR-028 reserved this seam for.
 */
async function mirrorDueDate(
  ticket: Ticket,
  resolutionTarget: Date | null,
  transaction: Transaction,
): Promise<void> {
  // FR-024a: a date a person set outranks the policy, permanently. This early
  // return is the whole of it.
  if (ticket.due_source !== 'policy') return;

  // NORMALISED TO NULL FIRST, and this is not defensive noise. A freshly
  // created Sequelize instance returns `undefined` for a column never
  // assigned, while a reloaded one returns `null`. Comparing with `!== null`
  // therefore passes for `undefined` and then dereferences it — which is
  // exactly how this line first shipped, and it took down every ticket
  // creation in the system with "cannot read properties of undefined".
  const previous = ticket.due_at ?? null;

  if (
    (previous === null && resolutionTarget === null) ||
    (previous !== null &&
      resolutionTarget !== null &&
      previous.getTime() === resolutionTarget.getTime())
  ) {
    // Still save if `due_source` changed above even though the date did not.
    if (ticket.changed()) await ticket.save({ transaction });
    return;
  }

  ticket.due_at = resolutionTarget;
  // A genuinely new date ARMS A NEW WARNING, exactly as a manual change does.
  // Phase 4 built `due_warning_sent_for` as a value comparison for this reason.
  ticket.due_warning_sent_for = null;

  await ticket.save({ transaction });
}

/**
 * Recompute after a priority or category change (FR-017).
 *
 * FROM THE ORIGINAL `started_at`, NOT FROM NOW. Elapsed time is neither
 * forgiven nor charged twice: a ticket six hours into an eight-hour target that
 * is raised to `urgent` gets urgent's target measured from when it arrived, so
 * it may be immediately at risk — which is correct, and is the point.
 *
 * Paused time is preserved by rebasing `started_at` forward by the total pause
 * already accumulated, so the recomputed target excludes it exactly once.
 */
export async function recompute(ticket: Ticket, transaction: Transaction): Promise<void> {
  const existing = await TicketSla.findByPk(ticket.id, { transaction });
  const policy = await policyService.matchFor({
    priority: ticket.priority,
    category: ticket.category,
  });

  // The ticket now matches nothing. Keep the row and its recorded outcomes —
  // the history of what was promised does not disappear because the policy set
  // changed — but stop measuring against a target that no longer exists.
  if (!policy) {
    if (existing) {
      const previous = existing.resolution_target_at;

      existing.policy_id = null;
      existing.response_target_at = null;
      existing.resolution_target_at = null;
      await existing.save({ transaction });

      await mirrorDueDate(ticket, null, transaction);
      await recordTargetChange(ticket.id, previous, null, transaction);
    }

    return;
  }

  if (!existing) {
    // It matched nothing before and matches something now: this is its first
    // commitment, and it starts from the ticket's own creation.
    await attachTargets(ticket, transaction, ticket.created_at);
    return;
  }

  const calendar = await calendarService.workingCalendar();
  const base = new Date(existing.started_at.getTime() + Number(existing.total_paused_ms));

  const previousResolution = existing.resolution_target_at;

  const nextResponse = addWorkingMinutes(base, policy.response_minutes, calendar);
  const nextResolution = addWorkingMinutes(base, policy.resolution_minutes, calendar);

  existing.policy_id = policy.id;
  // A target already satisfied stays satisfied — FR-016. Recomputing the
  // response target of a ticket that has already been replied to would re-arm a
  // promise that was kept.
  if (existing.response_satisfied_at === null) {
    existing.response_target_at = nextResponse;
    // A NEW value re-arms the warning and, for resolution, the escalation. That
    // is the whole reason the markers hold a value rather than a flag (D4).
    existing.response_warned_for = null;
  }

  if (existing.resolution_satisfied_at === null) {
    existing.resolution_target_at = nextResolution;
    existing.resolution_warned_for = null;
    existing.resolution_escalated_for = null;
  }

  // If it was paused, what remains is measured against the NEW target.
  if (existing.paused_at !== null) {
    existing.response_remaining_ms =
      existing.response_satisfied_at === null
        ? workingTimeBetween(existing.paused_at, nextResponse, calendar)
        : null;
    existing.resolution_remaining_ms =
      existing.resolution_satisfied_at === null
        ? workingTimeBetween(existing.paused_at, nextResolution, calendar)
        : null;
  }

  await existing.save({ transaction });
  await mirrorDueDate(ticket, existing.resolution_target_at, transaction);
  await recordTargetChange(
    ticket.id,
    previousResolution,
    existing.resolution_target_at,
    transaction,
  );
}

async function recordTargetChange(
  ticketId: number,
  previous: Date | null,
  next: Date | null,
  transaction: Transaction,
): Promise<void> {
  const same =
    (previous === null && next === null) ||
    (previous !== null && next !== null && previous.getTime() === next.getTime());

  if (same) return;

  await historyService.record(
    {
      ticketId,
      event: historyService.TICKET_EVENTS.SLA_TARGET_CHANGED,
      actor: historyService.SYSTEM_ACTOR,
      field: 'slaResolutionTarget',
      previousValue: previous === null ? null : previous.toISOString(),
      newValue: next === null ? null : next.toISOString(),
    },
    transaction,
  );
}

/**
 * Stop the clock (FR-021, research D3).
 *
 * Captures what was LEFT rather than when we stopped, so resuming needs no
 * arithmetic against the pause duration and cannot double-count it.
 */
export async function pause(ticketId: number, at: Date, transaction: Transaction): Promise<void> {
  const row = await TicketSla.findByPk(ticketId, { transaction });

  if (!row || row.paused_at !== null) return;

  const calendar = await calendarService.workingCalendar();

  row.response_remaining_ms =
    row.response_satisfied_at === null && row.response_target_at !== null
      ? workingTimeBetween(at, row.response_target_at, calendar)
      : null;
  row.resolution_remaining_ms =
    row.resolution_satisfied_at === null && row.resolution_target_at !== null
      ? workingTimeBetween(at, row.resolution_target_at, calendar)
      : null;
  row.paused_at = at;

  await row.save({ transaction });

  await historyService.record(
    {
      ticketId,
      event: historyService.TICKET_EVENTS.SLA_CLOCK_PAUSED,
      actor: historyService.SYSTEM_ACTOR,
      field: 'slaClock',
      newValue: 'paused',
    },
    transaction,
  );
}

/** Restart the clock: the target becomes "now plus what was left". */
export async function resume(ticketId: number, at: Date, transaction: Transaction): Promise<void> {
  const row = await TicketSla.findByPk(ticketId, { transaction });

  if (!row || row.paused_at === null) return;

  const calendar = await calendarService.workingCalendar();
  const previousResolution = row.resolution_target_at;

  if (row.response_remaining_ms !== null) {
    row.response_target_at = addWorkingMinutes(
      at,
      row.response_remaining_ms / MS_PER_MINUTE,
      calendar,
    );
    row.response_warned_for = null;
  }

  if (row.resolution_remaining_ms !== null) {
    row.resolution_target_at = addWorkingMinutes(
      at,
      row.resolution_remaining_ms / MS_PER_MINUTE,
      calendar,
    );
    row.resolution_warned_for = null;
    row.resolution_escalated_for = null;
  }

  // Accumulated for DISPLAY ONLY — never used in the arithmetic above. See the
  // module comment: using it would deduct non-working time twice.
  row.total_paused_ms = Number(row.total_paused_ms) + (at.getTime() - row.paused_at.getTime());
  row.paused_at = null;
  row.response_remaining_ms = null;
  row.resolution_remaining_ms = null;

  await row.save({ transaction });

  const ticket = await Ticket.findByPk(ticketId, { transaction });
  if (ticket) await mirrorDueDate(ticket, row.resolution_target_at, transaction);

  await historyService.record(
    {
      ticketId,
      event: historyService.TICKET_EVENTS.SLA_CLOCK_RESUMED,
      actor: historyService.SYSTEM_ACTOR,
      field: 'slaClock',
      previousValue: 'paused',
      newValue:
        previousResolution === null ? null : (row.resolution_target_at?.toISOString() ?? null),
    },
    transaction,
  );
}

/**
 * The first outbound customer-visible message satisfies the response target
 * (FR-015).
 *
 * WRITE-ONCE. Nothing clears `response_satisfied_at`, so FR-016 — "once
 * satisfied, stays satisfied" — holds by construction rather than by a guard
 * somebody could forget. An internal note never reaches here: only
 * message.service's outbound path calls it.
 */
export async function satisfyResponse(
  ticketId: number,
  at: Date,
  transaction: Transaction,
): Promise<void> {
  const row = await TicketSla.findByPk(ticketId, { transaction });

  if (!row || row.response_satisfied_at !== null) return;

  row.response_satisfied_at = at;
  row.response_remaining_ms = null;
  await row.save({ transaction });
}

/** Resolving or closing satisfies the resolution target. */
export async function satisfyResolution(
  ticketId: number,
  at: Date,
  transaction: Transaction,
): Promise<void> {
  const row = await TicketSla.findByPk(ticketId, { transaction });

  if (!row || row.resolution_satisfied_at !== null) return;

  row.resolution_satisfied_at = at;
  row.resolution_remaining_ms = null;
  await row.save({ transaction });
}

/**
 * Reopening arms a FRESH resolution target under the currently matching policy
 * (FR-030).
 *
 * A reopened ticket must not be instantly breached by a target that expired
 * weeks ago. Because the new target is a different VALUE, the escalation marker
 * no longer matches it and a new escalation is armed — the property research D4
 * chose value markers for.
 *
 * The ORIGINAL outcome is preserved: `resolution_breached_at` is not cleared,
 * because it happened.
 */
export async function rearmOnReopen(
  ticket: Ticket,
  at: Date,
  transaction: Transaction,
): Promise<void> {
  const row = await TicketSla.findByPk(ticket.id, { transaction });

  if (!row) {
    await attachTargets(ticket, transaction, at);
    return;
  }

  const policy = await policyService.matchFor({
    priority: ticket.priority,
    category: ticket.category,
  });

  if (!policy) return;

  const calendar = await calendarService.workingCalendar();
  const previous = row.resolution_target_at;

  row.policy_id = policy.id;
  row.started_at = at;
  row.resolution_satisfied_at = null;
  row.resolution_target_at = addWorkingMinutes(at, policy.resolution_minutes, calendar);
  row.resolution_warned_for = null;
  row.resolution_escalated_for = null;
  row.paused_at = null;
  row.resolution_remaining_ms = null;

  await row.save({ transaction });
  await mirrorDueDate(ticket, row.resolution_target_at, transaction);
  await recordTargetChange(ticket.id, previous, row.resolution_target_at, transaction);
}

/** Called by the lifecycle service on every status change. */
export async function onStatusChange(
  ticket: Ticket,
  from: TicketStatus,
  to: TicketStatus,
  at: Date,
  transaction: Transaction,
): Promise<void> {
  // Reopening first: it is the only transition that arms a new commitment.
  if (isResolvedStatus(from) && !isResolvedStatus(to)) {
    await rearmOnReopen(ticket, at, transaction);
    return;
  }

  if (isResolvedStatus(to)) {
    await satisfyResolution(ticket.id, at, transaction);
    return;
  }

  if (isPausedStatus(to) && !isPausedStatus(from)) {
    await pause(ticket.id, at, transaction);
    return;
  }

  if (isPausedStatus(from) && !isPausedStatus(to)) {
    await resume(ticket.id, at, transaction);
  }
}

// --- Reading -------------------------------------------------------------

export type SlaTargetState = 'met' | 'on_track' | 'at_risk' | 'breached';

export interface SlaTargetView {
  targetAt: string | null;
  state: SlaTargetState;
  remainingMinutes: number | null;
  satisfiedAt: string | null;
}

export interface SlaView {
  policyId: number | null;
  policyName: string | null;
  response: SlaTargetView;
  resolution: SlaTargetView;
  isPaused: boolean;
  dueSource: string;
}

function stateFor(
  target: Date | null,
  satisfiedAt: Date | null,
  remainingMs: number | null,
  warningLeadMs: number,
): SlaTargetState {
  if (satisfiedAt !== null) return 'met';
  if (target === null) return 'on_track';
  if (remainingMs === null) return 'breached';
  if (remainingMs <= 0) return 'breached';
  return remainingMs <= warningLeadMs ? 'at_risk' : 'on_track';
}

/**
 * The ticket API's `sla` field.
 *
 * `state` IS COMPUTED SERVER-SIDE against the one authoritative clock (FR-011).
 * A client deriving it from `targetAt` and its own clock is how "overdue" comes
 * to mean two different things for a viewer in Cairo and one in London, which
 * SC-002 forbids.
 */
export async function viewFor(
  ticket: Ticket,
  row: TicketSla | null,
  policyName: string | null,
  warningLeadMinutes: number,
  at: Date = clockNow(),
): Promise<SlaView | null> {
  // FR-014: null, not an object of nulls, so no consumer can render
  // "0 minutes remaining" for a ticket that was never promised anything.
  if (!row) return null;

  const calendar = await calendarService.workingCalendar();
  const warningLeadMs = warningLeadMinutes * MS_PER_MINUTE;
  const closed = ticket.status === 'closed';

  const remaining = (
    target: Date | null,
    satisfied: Date | null,
    paused: number | null,
  ): number | null => {
    if (satisfied !== null || target === null) return null;
    // While paused the countdown is FROZEN at what was left (FR-020): a ticket
    // waiting on the customer that appears to be burning its clock is the bug
    // User Story 6 exists to prevent.
    if (row.paused_at !== null) return paused;
    return workingTimeBetween(at, target, calendar);
  };

  const responseRemaining = remaining(
    row.response_target_at,
    row.response_satisfied_at,
    row.response_remaining_ms,
  );
  const resolutionRemaining = remaining(
    row.resolution_target_at,
    row.resolution_satisfied_at,
    row.resolution_remaining_ms,
  );

  const toView = (
    target: Date | null,
    satisfied: Date | null,
    remainingMs: number | null,
  ): SlaTargetView => ({
    targetAt: target === null ? null : target.toISOString(),
    // FR-032: a closed ticket is finished, and reporting it as breached is
    // noise about work nobody is going to do — consistent with Phase 4 FR-027.
    state:
      closed && satisfied === null
        ? 'met'
        : stateFor(target, satisfied, remainingMs, warningLeadMs),
    remainingMinutes:
      remainingMs === null ? null : Math.max(0, Math.round(remainingMs / MS_PER_MINUTE)),
    satisfiedAt: satisfied === null ? null : satisfied.toISOString(),
  });

  return {
    policyId: row.policy_id,
    policyName,
    response: toView(row.response_target_at, row.response_satisfied_at, responseRemaining),
    resolution: toView(row.resolution_target_at, row.resolution_satisfied_at, resolutionRemaining),
    isPaused: row.paused_at !== null,
    dueSource: ticket.due_source,
  };
}
