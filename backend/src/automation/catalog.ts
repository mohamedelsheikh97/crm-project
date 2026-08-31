import { TICKET_STATUSES } from '../tickets/lifecycle.js';
import { TICKET_CATEGORIES, allPriorityKeys } from '../tickets/taxonomy.js';
import { TICKET_SOURCES } from '../models/ticket.model.js';
import { ALL_CHANNELS } from '../models/message.model.js';

/**
 * THE CLOSED CATALOG (Phase 6, research.md D9, FR-056-FR-058).
 *
 * This file IS FR-058's bounded authority. A rule can do nothing that is not
 * listed here, enforced at WRITE TIME, which is what lets the executor trust
 * its input and what makes a misconfigured rule fail in front of its author
 * rather than at 03:00 on a stranger's email.
 *
 * That matters more here than anywhere else in this codebase. Phase 5 opened
 * the system to the public internet but confined what arriving input could do.
 * A rule triggered by "a message arrived" means a STRANGER'S EMAIL can flip a
 * status, reassign work, and cause an outbound send — with no user, no role,
 * and no route middleware anywhere in the path. Nothing checks a permission at
 * the moment a rule fires, because there is nobody to check. What stands in its
 * place is: this catalog, the depth bound, and the fact that every action
 * executes through the service a person's request would call.
 *
 * A DECLARATION, not logic. The endpoint that lists the catalog to the builder
 * screen, the validator that accepts a rule, and the executor that runs one all
 * read these constants. Nothing holds a second copy — so the screen can never
 * offer a combination the validator refuses.
 *
 * ADDING TO IT is how a later phase extends automation: Phase 7's
 * "suggest an article" is one entry here plus one branch in the executor.
 * Widening it in any other way — a free-text expression, a webhook, a raw
 * message body — reopens the security surface this file closes.
 */

// --- Triggers --------------------------------------------------------------

/**
 * FR-056 names six trigger classes; these eight cover them, splitting
 * assignment into assigned and unassigned because a rule reacting to work being
 * TAKEN AWAY is a different rule from one reacting to it arriving.
 */
export const TRIGGERS = [
  { key: 'ticket.created', nameKey: 'automation.trigger.ticketCreated' },
  { key: 'ticket.status_changed', nameKey: 'automation.trigger.statusChanged' },
  { key: 'ticket.priority_changed', nameKey: 'automation.trigger.priorityChanged' },
  { key: 'ticket.assigned', nameKey: 'automation.trigger.assigned' },
  { key: 'ticket.unassigned', nameKey: 'automation.trigger.unassigned' },
  { key: 'message.received', nameKey: 'automation.trigger.messageReceived' },
  { key: 'sla.at_risk', nameKey: 'automation.trigger.slaAtRisk' },
  { key: 'sla.breached', nameKey: 'automation.trigger.slaBreached' },
] as const;

export type TriggerKey = (typeof TRIGGERS)[number]['key'];

const TRIGGER_SET: ReadonlySet<string> = new Set(TRIGGERS.map((t) => t.key));

export function isTriggerKey(value: unknown): value is TriggerKey {
  return typeof value === 'string' && TRIGGER_SET.has(value);
}

// --- Conditions ------------------------------------------------------------

export type ConditionOperator = 'is' | 'is_not' | 'in';

export interface ConditionField {
  key: string;
  nameKey: string;
  operators: readonly ConditionOperator[];
  /** The permitted values. A value outside this set is refused on write. */
  values: readonly string[];
  /**
   * Present only where the field cannot be evaluated on every trigger.
   * `message.channel` has no meaning on `ticket.created`, and a rule that can
   * NEVER fire is a configuration bug to catch at save time, not a silent
   * no-op to discover months later.
   */
  onlyForTriggers?: readonly TriggerKey[];
}

const BOOLEAN_VALUES = ['true', 'false'] as const;

export const CONDITION_FIELDS = [
  {
    key: 'ticket.priority',
    nameKey: 'automation.condition.priority',
    operators: ['is', 'is_not', 'in'],
    values: allPriorityKeys(),
  },
  {
    key: 'ticket.category',
    nameKey: 'automation.condition.category',
    operators: ['is', 'is_not', 'in'],
    values: TICKET_CATEGORIES,
  },
  {
    key: 'ticket.status',
    nameKey: 'automation.condition.status',
    operators: ['is', 'is_not', 'in'],
    values: TICKET_STATUSES,
  },
  {
    key: 'ticket.source',
    nameKey: 'automation.condition.source',
    operators: ['is', 'is_not', 'in'],
    values: TICKET_SOURCES,
  },
  {
    key: 'ticket.has_assignee',
    nameKey: 'automation.condition.hasAssignee',
    operators: ['is'],
    values: BOOLEAN_VALUES,
  },
  {
    key: 'ticket.sla_state',
    nameKey: 'automation.condition.slaState',
    operators: ['is', 'is_not'],
    values: ['none', 'on_track', 'at_risk', 'breached'],
  },
  {
    // Included because Phase 5 created the concept and routing an unverified
    // sender differently is the obvious first use of it.
    key: 'customer.is_provisional',
    nameKey: 'automation.condition.customerProvisional',
    operators: ['is'],
    values: BOOLEAN_VALUES,
  },
  {
    key: 'message.channel',
    nameKey: 'automation.condition.messageChannel',
    operators: ['is', 'in'],
    values: ALL_CHANNELS,
    onlyForTriggers: ['message.received'],
  },
] as const satisfies readonly ConditionField[];

export type ConditionFieldKey = (typeof CONDITION_FIELDS)[number]['key'];

const FIELD_BY_KEY = new Map<string, ConditionField>(
  CONDITION_FIELDS.map((field) => [field.key, field as ConditionField]),
);

export function conditionField(key: string): ConditionField | null {
  return FIELD_BY_KEY.get(key) ?? null;
}

/**
 * NO free text, NO regex, NO numeric comparison on elapsed time. FR-054 asks
 * for a screen, not a syntax; and elapsed-time conditions are what the
 * `sla.at_risk` and `sla.breached` TRIGGERS already express correctly, against
 * the one authoritative clock rather than against a number a user typed.
 */

// --- Actions ---------------------------------------------------------------

export interface ActionParam {
  key: string;
  /** `enum` params are validated against `values`; `ids` against existence. */
  kind: 'enum' | 'userId' | 'userIds' | 'roleId' | 'templateId' | 'localeKey';
  values?: readonly string[];
  required: boolean;
}

export interface ActionDefinition {
  key: string;
  nameKey: string;
  params: readonly ActionParam[];
}

export const ACTIONS = [
  {
    key: 'set_priority',
    nameKey: 'automation.action.setPriority',
    params: [{ key: 'priority', kind: 'enum', values: allPriorityKeys(), required: true }],
  },
  {
    key: 'set_category',
    nameKey: 'automation.action.setCategory',
    params: [{ key: 'category', kind: 'enum', values: TICKET_CATEGORIES, required: true }],
  },
  {
    // Executes through ticket-lifecycle.service, so TRANSITIONS governs it.
    // An undeclared edge is refused and the run is recorded as failed — not
    // forced (FR-038, FR-058).
    key: 'change_status',
    nameKey: 'automation.action.changeStatus',
    params: [{ key: 'status', kind: 'enum', values: TICKET_STATUSES, required: true }],
  },
  {
    key: 'assign_to_user',
    nameKey: 'automation.action.assignToUser',
    params: [{ key: 'userId', kind: 'userId', required: true }],
  },
  {
    key: 'apply_assignment_strategy',
    nameKey: 'automation.action.applyAssignmentStrategy',
    params: [],
  },
  {
    key: 'notify_users',
    nameKey: 'automation.action.notifyUsers',
    params: [
      { key: 'userIds', kind: 'userIds', required: false },
      { key: 'roleId', kind: 'roleId', required: false },
    ],
  },
  {
    /**
     * A TEMPLATE ID OR A LOCALE KEY, NEVER A RAW BODY. Two reasons, both
     * load-bearing:
     *
     *   - FR-080 requires the RECIPIENT'S language to be chosen at delivery,
     *     and a body stored in a rule has already chosen one.
     *   - A raw body in a rule is a machine that sends the same English
     *     sentence to every customer forever.
     *
     * Phase 4's reply-template library is the intended source — which is
     * exactly the "Phase 5 adds channels as new insertion targets rather than
     * rebuilding the library" promise Phase 4 Clarifications Q2 made, collected
     * here.
     */
    key: 'send_customer_message',
    nameKey: 'automation.action.sendCustomerMessage',
    params: [
      { key: 'templateId', kind: 'templateId', required: false },
      { key: 'bodyKey', kind: 'localeKey', required: false },
    ],
  },
] as const satisfies readonly ActionDefinition[];

export type ActionKey = (typeof ACTIONS)[number]['key'];

const ACTION_BY_KEY = new Map<string, ActionDefinition>(
  ACTIONS.map((action) => [action.key, action as ActionDefinition]),
);

export function actionDefinition(key: string): ActionDefinition | null {
  return ACTION_BY_KEY.get(key) ?? null;
}

/**
 * WHAT IS DELIBERATELY ABSENT, stated so a later phase adds it on purpose
 * rather than assuming it was forgotten:
 *
 *   - `create_task` — Phase 4 Clarifications Q3 made tasks personal. A rule
 *     cannot create one for someone else, because no mechanism for that exists.
 *   - `close_ticket` / `reopen_ticket` — reachable through `change_status`,
 *     and therefore already governed by the lifecycle's tickets:close and
 *     tickets:reopen edges. A dedicated action would invite a bypass of them.
 *   - `merge_tickets` / `link_tickets` — merge is irreversible and
 *     identity-sensitive. Not a thing to automate on a stranger's email.
 *   - `call_webhook` — Phase 11.
 *   - `suggest_article` — Phase 7. One entry here plus one executor branch.
 */

/** The whole catalog, as the builder screen consumes it. */
export function catalog(): {
  triggers: typeof TRIGGERS;
  conditionFields: typeof CONDITION_FIELDS;
  actions: typeof ACTIONS;
} {
  return { triggers: TRIGGERS, conditionFields: CONDITION_FIELDS, actions: ACTIONS };
}
