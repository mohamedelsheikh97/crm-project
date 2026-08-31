import type { Transaction } from 'sequelize';

import { env } from '../config/env.js';
import { conditionField, type ConditionOperator } from '../automation/catalog.js';
import {
  cascade,
  contextForEmission,
  seenKey,
  type AutomationEvent,
  type ExecutionContext,
} from '../automation/events.js';
import { logger } from '../middleware/request-logger.js';
import {
  AutomationRule,
  AutomationRun,
  Customer,
  Ticket,
  TicketSla,
  User,
} from '../models/index.js';
import type { AppliedAction, RunOutcome } from '../models/automation-run.model.js';
import type { RuleAction, RuleCondition } from '../models/automation-rule.model.js';

/**
 * THE RULE ENGINE (Phase 6, FR-054-FR-071, research.md D10).
 *
 * Separated from automation.service.ts, which owns the catalog, validation and
 * CRUD: that file is what an administrator's request talks to, and this is what
 * runs at 03:00 with nobody watching. They share the catalog and nothing else.
 *
 * FOUR PROPERTIES, and none of them is a check somebody has to remember:
 *
 * 1. NOTHING RUNS BEFORE ITS TRANSACTION COMMITS. `emit` registers an
 *    `afterCommit` callback and returns; it evaluates nothing synchronously. A
 *    rule that acted on a state which then rolled back is a lie no query can
 *    fix, and it is the exact failure `notification-hub.ts` was written to
 *    prevent in Phase 4.
 *
 * 2. NOTHING PROPAGATES (FR-071). The whole cascade is wrapped. A customer's
 *    message or an agent's save must never fail because a rule failed — and by
 *    the time any of this runs the enclosing transaction has already committed,
 *    so there is nothing left to roll back and nothing to gain from throwing.
 *
 * 3. EXECUTION IS BOUNDED (FR-062-FR-064). `depth` caps the cascade; the `seen`
 *    set stops a rule re-running on the same ticket within one originating
 *    event. Both are carried in the context rather than stored, so they cannot
 *    leak between unrelated events.
 *
 * 4. AUTHORITY IS BORROWED, NEVER GRANTED (FR-058). Every action calls the
 *    service a person's request would call, with a system actor. The lifecycle,
 *    the assignee eligibility test, opt-out, the reply window and the rate
 *    limits all apply to automation because it goes through the same doors —
 *    not because this file re-implements them.
 */

/** What one rule did, for the run record. */
interface RunOutcomeDetail {
  outcome: RunOutcome;
  detail: { key: string; params?: Record<string, unknown> } | null;
  actions: AppliedAction[];
}

/**
 * Emit an event for rule evaluation.
 *
 * Registers an `afterCommit` and returns immediately. Callers pass their own
 * transaction, so the ordering rule holds without any caller having to know it.
 */
export function emit(event: AutomationEvent, transaction: Transaction): void {
  // CAPTURED AT EMIT TIME, not inside the callback: by the time `afterCommit`
  // fires, the async context of the code that caused this event may be gone.
  // Reading it here is what lets a cascade started three rules ago still know
  // how deep it is (FR-062).
  const context = contextForEmission(event.trigger);

  transaction.afterCommit(() => {
    // Deliberately not awaited and deliberately swallowed: see property 2.
    void cascade
      .run(context, () => run(event, context))
      .catch((error: unknown) => {
        logger.error({ err: error, event }, 'Automation cascade failed');
      });
  });
}

/** Evaluate every enabled rule for this trigger, in order (FR-060). */
export async function run(event: AutomationEvent, context: ExecutionContext): Promise<void> {
  const rules = await AutomationRule.findAll({
    where: { is_enabled: true, trigger_key: event.trigger },
    order: [
      ['run_order', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  for (const rule of rules) {
    try {
      await runOne(rule, event, context);
    } catch (error) {
      // One rule failing must not stop the rules after it: they are independent
      // configurations that happen to share a trigger.
      await record(rule, event, context, {
        outcome: 'failed',
        detail: {
          key: 'automation.failed.unexpected',
          params: { message: error instanceof Error ? error.message : 'unknown' },
        },
        actions: [],
      });
    }
  }
}

async function runOne(
  rule: AutomationRule,
  event: AutomationEvent,
  context: ExecutionContext,
): Promise<void> {
  // FR-062. Depth 0 is the originating event, so the default of 3 permits
  // "arrival sets priority → priority change assigns → assignment notifies".
  if (context.depth > env.AUTOMATION_MAX_DEPTH) {
    await record(rule, event, context, {
      outcome: 'suppressed',
      detail: {
        key: 'automation.suppressed.depthExceeded',
        params: { max: env.AUTOMATION_MAX_DEPTH },
      },
      actions: [],
    });
    return;
  }

  // FR-063, FR-064. A rule that has already acted on this ticket within this
  // cascade does not act again — which is what breaks a two-rule cycle without
  // needing to detect the cycle itself.
  const key = seenKey(rule.id, event.ticketId);

  if (context.seen.has(key)) {
    await record(rule, event, context, {
      outcome: 'suppressed',
      detail: { key: 'automation.suppressed.alreadyRan', params: { ruleId: rule.id } },
      actions: [],
    });
    return;
  }

  const subject = await loadSubject(event.ticketId);

  if (!subject) return;

  if (!(await matches(rule.conditions_json ?? [], subject, event))) {
    // RECORDED, not discarded (FR-067). "The rule never ran" and "the rule ran
    // and the conditions did not hold" are different diagnoses that look
    // identical from an empty table.
    await record(rule, event, context, { outcome: 'no_match', detail: null, actions: [] });
    return;
  }

  context.seen.add(key);

  const applied = await execute(rule.actions_json ?? [], subject);
  const anySucceeded = applied.some((entry) => entry.result === 'ok');

  await record(rule, event, context, {
    // `acted` even with some failures: FR-065 says an independent action's
    // failure must not abort its siblings, and `actionsApplied` names which.
    outcome: anySucceeded ? 'acted' : 'failed',
    detail: null,
    actions: applied,
  });
}

// --- Conditions ------------------------------------------------------------

/** Everything a condition can read. Loaded once per rule evaluation. */
interface Subject {
  ticket: Ticket;
  customer: Customer | null;
  sla: TicketSla | null;
}

async function loadSubject(ticketId: number): Promise<Subject | null> {
  const ticket = await Ticket.findByPk(ticketId);

  if (!ticket) return null;

  const [customer, sla] = await Promise.all([
    Customer.findByPk(ticket.customer_id),
    TicketSla.findByPk(ticket.id),
  ]);

  return { ticket, customer, sla };
}

function slaStateOf(sla: TicketSla | null, now: Date): string {
  if (!sla || sla.resolution_target_at === null) return 'none';
  if (sla.resolution_satisfied_at !== null) return 'on_track';
  if (sla.resolution_target_at.getTime() <= now.getTime()) return 'breached';

  const lead = env.SLA_WARNING_LEAD_MINUTES * 60_000;

  return sla.resolution_target_at.getTime() - now.getTime() <= lead ? 'at_risk' : 'on_track';
}

/** The value a condition field reads, as a string for uniform comparison. */
function valueOf(field: string, subject: Subject, event: AutomationEvent): string | null {
  switch (field) {
    case 'ticket.priority':
      return subject.ticket.priority;
    case 'ticket.category':
      return subject.ticket.category;
    case 'ticket.status':
      return subject.ticket.status;
    case 'ticket.source':
      return subject.ticket.source;
    case 'ticket.has_assignee':
      return subject.ticket.assignee_user_id === null ? 'false' : 'true';
    case 'ticket.sla_state':
      return slaStateOf(subject.sla, new Date());
    case 'customer.is_provisional':
      return (subject.customer as unknown as { is_provisional?: boolean })?.is_provisional
        ? 'true'
        : 'false';
    case 'message.channel':
      return event.trigger === 'message.received' ? event.channel : null;
    default:
      return null;
  }
}

function satisfies(operator: ConditionOperator, actual: string | null, expected: unknown): boolean {
  if (actual === null) return false;

  switch (operator) {
    case 'is':
      return actual === String(expected);
    case 'is_not':
      return actual !== String(expected);
    case 'in':
      return Array.isArray(expected) && expected.map(String).includes(actual);
    default:
      return false;
  }
}

/**
 * EVERY condition must hold (FR-059).
 *
 * There is no `or`, and the interface says so in words rather than leaving the
 * semantics to be inferred — which is the difference between a rule an
 * administrator can reason about and one they have to experiment with.
 */
async function matches(
  conditions: RuleCondition[],
  subject: Subject,
  event: AutomationEvent,
): Promise<boolean> {
  for (const condition of conditions) {
    const field = conditionField(condition.field);

    // A field the catalog no longer contains: the rule is stale, and refusing
    // to match is the safe reading — doing something on the strength of a
    // condition nobody can evaluate is worse than doing nothing.
    if (!field) return false;

    if (
      !satisfies(
        condition.operator as ConditionOperator,
        valueOf(condition.field, subject, event),
        condition.value,
      )
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Which recent tickets a rule WOULD match, and what it would do (FR-066).
 *
 * PURE. It reads the same condition evaluator the executor uses and never
 * touches the action executor at all, which is what makes the dry run
 * trustworthy rather than a simulation that might have side effects.
 */
export async function dryRun(
  triggerKey: string,
  conditions: RuleCondition[],
  actions: RuleAction[],
  sampleSize = 50,
): Promise<{
  sampleSize: number;
  matched: Array<{ ticket: { id: number; subject: string }; wouldApply: RuleAction[] }>;
  unmatchedCount: number;
}> {
  const tickets = await Ticket.findAll({
    where: { merged_into_ticket_id: null },
    order: [['id', 'DESC']],
    limit: sampleSize,
  });

  const matched: Array<{ ticket: { id: number; subject: string }; wouldApply: RuleAction[] }> = [];

  for (const ticket of tickets) {
    const subject = await loadSubject(ticket.id);

    if (!subject) continue;

    // A synthetic event of the right shape. `message.channel` conditions cannot
    // be evaluated against a historical ticket, and `matches` returns false for
    // a null value — so such a rule reports no matches rather than a wrong one.
    const event = {
      trigger: triggerKey,
      ticketId: ticket.id,
      actorUserId: null,
    } as unknown as AutomationEvent;

    if (await matches(conditions, subject, event)) {
      matched.push({
        ticket: { id: ticket.id, subject: ticket.subject },
        // DESCRIBED, never executed — and described from the same stored
        // definition the executor reads, so a dry run cannot promise something
        // the executor would do differently.
        wouldApply: actions,
      });
    }
  }

  return { sampleSize: tickets.length, matched, unmatchedCount: tickets.length - matched.length };
}

// --- Actions ---------------------------------------------------------------

/**
 * Run a rule's actions, INDEPENDENTLY (FR-065).
 *
 * One failing action does not abort the others: they are separate instructions
 * that happen to share a trigger, and aborting the rest would make a rule's
 * behaviour depend on the order somebody happened to list them in.
 */
async function execute(actions: RuleAction[], subject: Subject): Promise<AppliedAction[]> {
  const applied: AppliedAction[] = [];

  for (const action of actions) {
    try {
      applied.push(await executeOne(action, subject));
    } catch (error) {
      applied.push({
        action: action.action,
        result: 'failed',
        detail: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  return applied;
}

async function executeOne(action: RuleAction, subject: Subject): Promise<AppliedAction> {
  const ticketService = await import('./ticket.service.js');
  const actor = ticketService.SYSTEM_ACTOR;

  switch (action.action) {
    case 'set_priority': {
      const from = subject.ticket.priority;
      const to = String(action.params.priority);

      if (from === to) return { action: action.action, result: 'ok', from, to };

      // Through ticket.service, so the merged-ticket refusal, the closed-ticket
      // refusal, the history entry and the audit record all apply — and so does
      // the SLA recomputation FR-017 requires.
      await ticketService.update(
        subject.ticket.id,
        { priority: to, version: subject.ticket.version },
        actor,
      );

      return { action: action.action, result: 'ok', from, to };
    }

    case 'set_category': {
      const from = subject.ticket.category;
      const to = String(action.params.category);

      if (from === to) return { action: action.action, result: 'ok', from, to };

      await ticketService.update(
        subject.ticket.id,
        { category: to, version: subject.ticket.version },
        actor,
      );

      return { action: action.action, result: 'ok', from, to };
    }

    case 'change_status': {
      const from = subject.ticket.status;
      const to = String(action.params.status);

      if (from === to) return { action: action.action, result: 'ok', from, to };

      // Through the lifecycle service: an UNDECLARED EDGE IS REFUSED and the
      // run records why. Automation gets no shortcut the lifecycle does not
      // give a person (FR-058, FR-038).
      await ticketService.transition(
        subject.ticket.id,
        {
          to,
          version: subject.ticket.version,
          // Escalation must say why (Phase 3 FR-029), and an i18n key rather
          // than a sentence so it renders in the reader's language.
          reason: to === 'escalated' ? 'ticket.automation.escalationReason' : undefined,
        },
        actor,
      );

      return { action: action.action, result: 'ok', from, to };
    }

    case 'assign_to_user': {
      const userId = Number(action.params.userId);
      const target = await User.findByPk(userId);

      // Refused rather than forced. `ticket.service.assign` enforces the same
      // three conditions for a person; this check only produces a clearer
      // record than a validation error would.
      if (!target || !target.is_active) {
        return { action: action.action, result: 'failed', detail: 'assignee not eligible' };
      }

      await ticketService.assign(
        subject.ticket.id,
        { userId, version: subject.ticket.version },
        actor,
      );

      return { action: action.action, result: 'ok', to: userId };
    }

    case 'apply_assignment_strategy': {
      const assignmentService = await import('./assignment.service.js');
      const outcome = await assignmentService.autoAssign(subject.ticket.id);

      return {
        action: action.action,
        result: outcome.assigned ? 'ok' : 'failed',
        detail: outcome.refusal ?? undefined,
        to: outcome.userId ?? undefined,
      };
    }

    case 'notify_users': {
      const alertService = await import('./alert.service.js');
      const { sequelize } = await import('../config/database.js');
      const { ALERT_EVENTS } = await import('../models/alert-subscription.model.js');

      await sequelize.transaction(async (transaction) => {
        await alertService.dispatch(
          ALERT_EVENTS.RESOLUTION_BREACHED,
          { ticketId: subject.ticket.id, assigneeUserId: subject.ticket.assignee_user_id },
          transaction,
        );
      });

      return { action: action.action, result: 'ok' };
    }

    case 'send_customer_message': {
      const messageService = await import('./message.service.js');

      // A TEMPLATE OR A LOCALE KEY, never a raw body — FR-080. The body is
      // resolved at send time so the recipient's language decides it, and a
      // rule cannot become a machine that sends the same English sentence to
      // every customer forever.
      const body = String(action.params.bodyKey ?? action.params.templateId ?? '');

      // Through message.service, so opt-out, the reply window, the replyable
      // channel check, the automated-mail rules and the per-conversation rate
      // limit all apply exactly as they do to an agent's reply (FR-074).
      await messageService.send(
        subject.ticket.id,
        { body },
        { id: 0, email: '', fullName: 'ticket.history.actor.system', roleId: 0 },
      );

      return { action: action.action, result: 'ok' };
    }

    default:
      // Unreachable while validation and this switch read the same catalog. If
      // it is ever reached, the rule names something the executor does not
      // implement, and doing nothing is the only safe answer.
      return { action: action.action, result: 'failed', detail: 'unknown action' };
  }
}

// --- The run record --------------------------------------------------------

async function record(
  rule: AutomationRule,
  event: AutomationEvent,
  context: ExecutionContext,
  outcome: RunOutcomeDetail,
): Promise<void> {
  await AutomationRun.create({
    rule_id: rule.id,
    // DENORMALISED: the record outlives the rule (FR-070).
    rule_name: rule.name,
    trigger_key: event.trigger,
    ticket_id: event.ticketId,
    outcome: outcome.outcome,
    // An i18n key and parameters, never a sentence — the same row may be read
    // by an Arabic user and an English one.
    detail: outcome.detail === null ? null : JSON.stringify(outcome.detail),
    actions_applied: outcome.actions.length > 0 ? outcome.actions : null,
    depth: context.depth,
  });
}
