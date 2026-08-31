import { Op, literal } from 'sequelize';

import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { now as clockNow } from '../lib/clock.js';
import { logger } from '../middleware/request-logger.js';
import { Ticket, TicketSla } from '../models/index.js';
import { ALERT_EVENTS } from '../models/alert-subscription.model.js';
import { isTransitionDeclared } from '../tickets/lifecycle.js';
import { toReference } from '../tickets/reference.js';
import * as alertService from './alert.service.js';
import * as automationEngine from './automation-engine.service.js';
import * as auditService from './audit.service.js';
import * as historyService from './ticket-history.service.js';

/**
 * BREACH DETECTION AND AUTOMATIC ESCALATION (Phase 6, FR-033-FR-042).
 *
 * This is PLAN.md's Definition of done for the phase: "A ticket that breaches
 * its SLA escalates and notifies the right people without manual intervention."
 *
 * THREE PROPERTIES, and each is structural rather than checked:
 *
 * 1. IT FIRES EXACTLY ONCE (FR-034). The marker column holds the TARGET VALUE
 *    that was acted on, not a boolean, and it is written in the SAME
 *    TRANSACTION as the act. A second pass compares the marker to the target,
 *    finds them equal, and matches nothing. Phase 4's `due_warning_sent_for`
 *    established the pattern and its source comment explains why a flag cannot
 *    work: a flag cannot tell a re-save from a reschedule.
 *
 * 2. IT DOES NOT DEPEND ON HAVING BEEN RUNNING (FR-035). The query is a state
 *    comparison, not a "since last run" ledger. A target that expired while the
 *    process was down is matched on the next pass, because the only thing that
 *    stops it matching is the marker — and the marker is only set when the work
 *    is done. There is no catch-up path to forget.
 *
 * 3. IT CANNOT ESCALATE ILLEGALLY (FR-038). The status change goes through the
 *    lifecycle declaration, not around it. Phase 6 ADDED `new -> escalated` to
 *    that declaration (research D11) precisely so the most important case — a
 *    ticket that arrived overnight and that nobody opened — is legal rather
 *    than refused.
 *
 * THE COLUMN-TO-COLUMN COMPARISON IS A `literal` ON PURPOSE. Sequelize's
 * operators compare a column to a VALUE; expressing "marker <> target" through
 * them produces a bound parameter holding the string "resolution_target_at",
 * which matches nothing and makes the sweep SILENTLY NEVER FIRE.
 * `ticket-due.service.ts` documents the same trap for the same reason.
 */

export interface SweepResult {
  warned: number;
  escalated: number;
  refused: number;
}

/**
 * Tickets past a target and not yet acted on for THIS value of it.
 *
 * `paused_at IS NULL` is FR-021: a ticket waiting on the customer is not late,
 * and the row is simply skipped rather than needing its target rewritten.
 */
function breachedWhere(now: Date, target: 'response' | 'resolution'): Record<string, unknown> {
  const targetColumn = `${target}_target_at`;
  const satisfiedColumn = `${target}_satisfied_at`;
  const markerColumn = target === 'resolution' ? 'resolution_escalated_for' : 'response_warned_for';

  return {
    [targetColumn]: { [Op.ne]: null, [Op.lte]: now },
    [satisfiedColumn]: null,
    paused_at: null,
    [Op.and]: literal(
      `(\`TicketSla\`.\`${markerColumn}\` IS NULL ` +
        `OR \`TicketSla\`.\`${markerColumn}\` <> \`TicketSla\`.\`${targetColumn}\`)`,
    ),
  };
}

/** Tickets approaching a target and not yet warned for THIS value of it. */
function atRiskWhere(now: Date, leadMinutes: number, target: 'response' | 'resolution') {
  const targetColumn = `${target}_target_at`;
  const satisfiedColumn = `${target}_satisfied_at`;
  const markerColumn = `${target}_warned_for`;
  const threshold = new Date(now.getTime() + leadMinutes * 60_000);

  return {
    // Approaching but NOT yet past: a ticket that blew through its target
    // without ever being warned is escalated, never warned retrospectively
    // (FR-037).
    [targetColumn]: { [Op.ne]: null, [Op.lte]: threshold, [Op.gt]: now },
    [satisfiedColumn]: null,
    paused_at: null,
    [Op.and]: literal(
      `(\`TicketSla\`.\`${markerColumn}\` IS NULL ` +
        `OR \`TicketSla\`.\`${markerColumn}\` <> \`TicketSla\`.\`${targetColumn}\`)`,
    ),
  };
}

/**
 * Tickets excluded from every sweep whatever their targets say.
 *
 * Closed is finished (FR-032, and Phase 4 FR-027 said the same about overdue).
 * Merged is a redirect (FR-031) — escalating a redirect would put a status on a
 * ticket nobody can work.
 */
const WORKABLE_TICKET = {
  status: { [Op.ne]: 'closed' },
  merged_into_ticket_id: null,
};

type Row = TicketSla & { ticket?: Ticket };

async function findRows(where: Record<string, unknown>): Promise<Row[]> {
  return (await TicketSla.findAll({
    where,
    include: [{ model: Ticket, as: 'ticket', required: true, where: WORKABLE_TICKET }],
    limit: 500,
  })) as Row[];
}

/**
 * Warn about an approaching target without escalating (FR-037).
 *
 * The marker is set in the same transaction as the alert, so the warning fires
 * once per target VALUE — and a rescheduled target arms a new one, because it
 * is a different value.
 */
async function warn(row: Row, target: 'response' | 'resolution', now: Date): Promise<void> {
  const ticket = row.ticket as Ticket;
  const eventKey =
    target === 'response' ? ALERT_EVENTS.RESPONSE_AT_RISK : ALERT_EVENTS.RESOLUTION_AT_RISK;

  await sequelize.transaction(async (transaction) => {
    await alertService.dispatch(
      eventKey,
      { ticketId: ticket.id, assigneeUserId: ticket.assignee_user_id },
      transaction,
    );

    row.set(`${target}_warned_for`, row.get(`${target}_target_at`));
    await row.save({ transaction });

    automationEngine.emit(
      { trigger: 'sla.at_risk', ticketId: ticket.id, actorUserId: null, target },
      transaction,
    );
  });

  logger.info({ ticketId: ticket.id, target }, 'SLA target approaching');
  void now;
}

/**
 * Escalate a breached ticket and tell the right people (FR-036, FR-041).
 *
 * THE STATUS CHANGE, THE REASON, THE HISTORY, THE AUDIT ENTRY, THE ALERT AND
 * THE MARKER ALL COMMIT TOGETHER. That is what makes FR-034 true: there is no
 * interleaving in which the ticket is escalated but the marker is not, which
 * would escalate it again on the next tick — nor one in which the marker is set
 * but nobody was told.
 */
async function escalate(row: Row, now: Date): Promise<'escalated' | 'refused'> {
  const ticket = row.ticket as Ticket;

  // FR-038. The lifecycle governs automation exactly as it governs a person,
  // and where an edge is genuinely undeclared the attempt is RECORDED AS
  // REFUSED rather than forced. `new -> escalated` was added to the declaration
  // in this phase (research D11) so the case that matters most is legal.
  if (!isTransitionDeclared(ticket.status, 'escalated')) {
    await sequelize.transaction(async (transaction) => {
      await historyService.record(
        {
          ticketId: ticket.id,
          event: historyService.TICKET_EVENTS.SLA_BREACHED,
          actor: historyService.SYSTEM_ACTOR,
          field: 'status',
          previousValue: ticket.status,
          newValue: null,
          note: 'ticket.sla.escalationRefused',
        },
        transaction,
      );

      // Marked anyway. The breach is real and has been recorded; retrying the
      // same refusal every minute would fill the history with noise about a
      // move that cannot be made.
      row.resolution_escalated_for = row.resolution_target_at;
      row.resolution_breached_at = row.resolution_breached_at ?? now;
      await row.save({ transaction });
    });

    logger.warn(
      { ticketId: ticket.id, status: ticket.status },
      'SLA breach could not escalate: the lifecycle does not declare the edge',
    );

    return 'refused';
  }

  await sequelize.transaction(async (transaction) => {
    const previousStatus = ticket.status;

    ticket.status = 'escalated';
    // FR-036: an i18n KEY, not a sentence — the reason is rendered in the
    // reader's language, and an Arabic supervisor must not be shown English.
    ticket.escalation_reason = 'ticket.sla.escalationReason.resolutionBreached';
    await ticket.save({ transaction });

    // FR-039: attributed to the SYSTEM. The ticket's timeline should read "the
    // system did this", because it did.
    await historyService.record(
      {
        ticketId: ticket.id,
        event: historyService.TICKET_EVENTS.ESCALATED,
        actor: historyService.SYSTEM_ACTOR,
        field: 'status',
        previousValue: previousStatus,
        newValue: 'escalated',
        note: ticket.escalation_reason,
      },
      transaction,
    );

    // FR-040. A null actor, because no person authorised this particular
    // escalation — a policy did, and FR-086 attributes to the system where
    // there is no configuring user.
    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.TICKET_ESCALATED,
        actorUserId: null,
        actorEmail: null,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        previousValue: { status: previousStatus },
        newValue: { status: 'escalated' },
        metadata: { automatic: true, reason: 'sla.resolution_breached' },
      },
      transaction,
    );

    // FR-041: the assignee AND the supervisory recipients, deduplicated. An
    // UNASSIGNED breached ticket still reaches the supervisory rows, which is
    // what stops it going unreported.
    await alertService.dispatch(
      ALERT_EVENTS.RESOLUTION_BREACHED,
      { ticketId: ticket.id, assigneeUserId: ticket.assignee_user_id },
      transaction,
    );

    row.resolution_breached_at = row.resolution_breached_at ?? now;
    // THE MARKER. Written here, with everything else, or not at all.
    row.resolution_escalated_for = row.resolution_target_at;
    await row.save({ transaction });

    // A breach is a trigger in its own right (FR-056), so an organisation can
    // add its own handling on top of the built-in escalation rather than
    // instead of it.
    automationEngine.emit(
      { trigger: 'sla.breached', ticketId: ticket.id, actorUserId: null, target: 'resolution' },
      transaction,
    );
  });

  logger.info({ ticketId: ticket.id }, 'SLA resolution target breached: ticket escalated');

  return 'escalated';
}

/** A breached FIRST-RESPONSE target: alerts, but does not escalate. */
async function reportResponseBreach(row: Row, now: Date): Promise<void> {
  const ticket = row.ticket as Ticket;

  await sequelize.transaction(async (transaction) => {
    await historyService.record(
      {
        ticketId: ticket.id,
        event: historyService.TICKET_EVENTS.SLA_BREACHED,
        actor: historyService.SYSTEM_ACTOR,
        field: 'responseTarget',
        previousValue: null,
        newValue: row.response_target_at?.toISOString() ?? null,
      },
      transaction,
    );

    await alertService.dispatch(
      ALERT_EVENTS.RESPONSE_BREACHED,
      { ticketId: ticket.id, assigneeUserId: ticket.assignee_user_id },
      transaction,
    );

    row.response_breached_at = row.response_breached_at ?? now;
    // Reuses the warn marker: once the response target is past, there is
    // nothing left to warn about, and one column keeps "already handled this
    // value" in one place.
    row.response_warned_for = row.response_target_at;
    await row.save({ transaction });
  });
}

/**
 * ONE PASS. Called by the scheduler every tick, and DIRECTLY BY TESTS with a
 * controlled clock — no test ever waits on a timer.
 *
 * Order: warnings first, then breaches. A ticket cannot receive both for the
 * same target in one pass, because the breach path sets the warn marker itself
 * and the at-risk query excludes anything already past its target (FR-037).
 */
export async function detectAndAct(now: Date = clockNow()): Promise<SweepResult> {
  const lead = env.SLA_WARNING_LEAD_MINUTES;
  const result: SweepResult = { warned: 0, escalated: 0, refused: 0 };

  for (const target of ['response', 'resolution'] as const) {
    for (const row of await findRows(atRiskWhere(now, lead, target))) {
      await warn(row, target, now);
      result.warned += 1;
    }
  }

  for (const row of await findRows(breachedWhere(now, 'response'))) {
    await reportResponseBreach(row, now);
  }

  for (const row of await findRows(breachedWhere(now, 'resolution'))) {
    const outcome = await escalate(row, now);

    if (outcome === 'escalated') result.escalated += 1;
    else result.refused += 1;
  }

  return result;
}
