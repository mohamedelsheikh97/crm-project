import { Op } from 'sequelize';

import { sequelize } from '../config/database.js';
import { notFound, staleRecord, validationError, type ErrorDetail } from '../errors/app-error.js';
import {
  actionDefinition,
  conditionField,
  catalog,
  isTriggerKey,
  type ActionDefinition,
} from '../automation/catalog.js';
import { AutomationRule, AutomationRun, Role, Ticket, User } from '../models/index.js';
import type { RuleAction, RuleCondition } from '../models/automation-rule.model.js';
import * as auditService from './audit.service.js';
import type { Actor, AuditContext, Paged } from './ticket.service.js';

/**
 * Automation rules: the catalog, validation, CRUD, and the run record
 * (Phase 6, FR-054-FR-070).
 *
 * VALIDATION HAPPENS AT WRITE TIME, and that is the whole of FR-058's bounded
 * authority (research D9). A stored rule cannot name a trigger, field,
 * operator, value, or action that automation/catalog.ts does not contain — so
 * the executor may trust its input, and a rule that would misbehave fails in
 * front of the person who wrote it rather than at 03:00 on a stranger's email.
 *
 * This matters more here than anywhere else in the codebase. A rule triggered
 * by "a message arrived" means untrusted input can cause a state change, with
 * no user, no role, and no route middleware in the path. Nothing checks a
 * permission at the moment a rule fires, because there is nobody to check.
 */

export interface RuleView {
  id: number;
  name: string;
  triggerKey: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  isEnabled: boolean;
  runOrder: number;
  createdBy: { id: number; fullName: string } | null;
  version: number;
}

type LoadedRule = AutomationRule & { createdBy?: User | null };

function toView(rule: LoadedRule): RuleView {
  return {
    id: rule.id,
    name: rule.name,
    triggerKey: rule.trigger_key,
    conditions: rule.conditions_json ?? [],
    actions: rule.actions_json ?? [],
    isEnabled: rule.is_enabled,
    runOrder: rule.run_order,
    createdBy: rule.createdBy
      ? { id: rule.createdBy.id, fullName: rule.createdBy.full_name }
      : null,
    version: rule.version,
  };
}

/**
 * The catalog, as the builder screen consumes it.
 *
 * The screen reads THIS, so it can never offer a combination the validator
 * would refuse — one declaration, three consumers, no second copy.
 */
export function ruleCatalog(): ReturnType<typeof catalog> {
  return catalog();
}

// --- Validation ------------------------------------------------------------

function validateConditions(
  raw: unknown,
  triggerKey: string,
  errors: ErrorDetail[],
): RuleCondition[] {
  if (raw === undefined || raw === null) return [];

  if (!Array.isArray(raw)) {
    errors.push({ field: 'conditions', message: 'automation.error.conditionsInvalid' });
    return [];
  }

  const conditions: RuleCondition[] = [];

  for (const entry of raw) {
    const candidate = entry as Partial<RuleCondition>;
    const field = conditionField(String(candidate.field ?? ''));

    if (!field) {
      errors.push({ field: 'conditions', message: 'automation.error.conditionFieldUnknown' });
      continue;
    }

    // A rule that can NEVER fire is a configuration bug to catch at save time,
    // not a silent no-op to discover months later: `message.channel` has no
    // meaning on `ticket.created`.
    if (field.onlyForTriggers && !field.onlyForTriggers.includes(triggerKey as never)) {
      errors.push({
        field: 'conditions',
        message: 'automation.error.conditionNotAvailableForTrigger',
      });
      continue;
    }

    const operator = String(candidate.operator ?? '');

    if (!field.operators.includes(operator as never)) {
      errors.push({ field: 'conditions', message: 'automation.error.operatorNotAllowed' });
      continue;
    }

    const values = operator === 'in' ? candidate.value : [candidate.value];

    if (!Array.isArray(values) || values.length === 0) {
      errors.push({ field: 'conditions', message: 'automation.error.valueInvalid' });
      continue;
    }

    const unknown = values.filter((value) => !field.values.includes(String(value) as never));

    if (unknown.length > 0) {
      errors.push({ field: 'conditions', message: 'automation.error.valueInvalid' });
      continue;
    }

    conditions.push({
      field: field.key,
      operator,
      value: operator === 'in' ? values.map(String) : String(values[0]),
    });
  }

  return conditions;
}

function validateActionParams(
  definition: ActionDefinition,
  params: Record<string, unknown>,
  errors: ErrorDetail[],
): boolean {
  for (const param of definition.params) {
    const value = params[param.key];

    if (value === undefined || value === null || value === '') {
      if (param.required) {
        errors.push({ field: 'actions', message: 'automation.error.actionParamsInvalid' });
        return false;
      }

      continue;
    }

    if (param.kind === 'enum' && !param.values?.includes(String(value) as never)) {
      errors.push({ field: 'actions', message: 'automation.error.actionParamsInvalid' });
      return false;
    }

    if ((param.kind === 'userId' || param.kind === 'roleId') && !Number.isInteger(Number(value))) {
      errors.push({ field: 'actions', message: 'automation.error.actionParamsInvalid' });
      return false;
    }

    // Phase 7. Validated as an integer HERE and for existence at EXECUTION
    // time, deliberately: an article that exists when a rule is saved can be
    // archived a month later, so 'does this article exist' is not a fact the
    // validator can settle. FR-047 makes that the executor's job, where it
    // becomes a recorded failure rather than a silent no-op.
    if (param.kind === 'articleId' && !Number.isInteger(Number(value))) {
      errors.push({ field: 'actions', message: 'automation.error.actionParamsInvalid' });
      return false;
    }

    if (param.kind === 'userIds' && !Array.isArray(value)) {
      errors.push({ field: 'actions', message: 'automation.error.actionParamsInvalid' });
      return false;
    }
  }

  return true;
}

function validateActions(raw: unknown, errors: ErrorDetail[]): RuleAction[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    // FR-055. A rule with no action is a rule that does nothing, which is a
    // configuration nobody meant to save.
    errors.push({ field: 'actions', message: 'automation.error.actionRequired' });
    return [];
  }

  const actions: RuleAction[] = [];

  for (const entry of raw) {
    const candidate = entry as Partial<RuleAction>;
    const definition = actionDefinition(String(candidate.action ?? ''));

    if (!definition) {
      errors.push({ field: 'actions', message: 'automation.error.actionUnknown' });
      continue;
    }

    const params = (candidate.params ?? {}) as Record<string, unknown>;

    if (!validateActionParams(definition, params, errors)) continue;

    // `notify_users` needs at least ONE recipient. Both params are individually
    // optional because either shape is legitimate; neither is not.
    if (
      definition.key === 'notify_users' &&
      (params.userIds === undefined || (params.userIds as unknown[])?.length === 0) &&
      params.roleId === undefined
    ) {
      errors.push({ field: 'actions', message: 'automation.error.actionParamsInvalid' });
      continue;
    }

    // FR-080: a customer-visible message names a template or a locale key,
    // NEVER a raw body — the recipient's language is chosen at delivery, and a
    // body stored in a rule has already chosen one.
    if (
      definition.key === 'send_customer_message' &&
      params.templateId === undefined &&
      params.bodyKey === undefined
    ) {
      errors.push({ field: 'actions', message: 'automation.error.actionParamsInvalid' });
      continue;
    }

    actions.push({ action: definition.key, params });
  }

  return actions;
}

interface ValidatedRule {
  name: string;
  triggerKey: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

function validate(input: Record<string, unknown>, current?: AutomationRule): ValidatedRule {
  const errors: ErrorDetail[] = [];

  const name = String(input.name ?? current?.name ?? '').trim();

  if (name === '') {
    errors.push({ field: 'name', message: 'automation.error.nameRequired' });
  }

  const triggerKey = String(input.triggerKey ?? current?.trigger_key ?? '');

  if (!isTriggerKey(triggerKey)) {
    errors.push({ field: 'triggerKey', message: 'automation.error.triggerUnknown' });
  }

  const conditions = validateConditions(
    input.conditions ?? current?.conditions_json ?? [],
    triggerKey,
    errors,
  );
  const actions = validateActions(input.actions ?? current?.actions_json, errors);

  if (errors.length > 0) throw validationError(errors);

  return { name, triggerKey, conditions, actions };
}

// --- CRUD ------------------------------------------------------------------

export async function listRules(): Promise<RuleView[]> {
  const rules = (await AutomationRule.findAll({
    include: [{ model: User, as: 'createdBy' }],
    // The run order (FR-060), which is the order the executor uses.
    order: [
      ['run_order', 'ASC'],
      ['id', 'ASC'],
    ],
  })) as LoadedRule[];

  return rules.map(toView);
}

export async function getRule(id: number): Promise<RuleView> {
  const rule = (await AutomationRule.findByPk(id, {
    include: [{ model: User, as: 'createdBy' }],
  })) as LoadedRule | null;

  if (!rule) throw notFound();

  return toView(rule);
}

export async function createRule(
  input: Record<string, unknown>,
  actor: Actor,
  context: AuditContext = {},
): Promise<RuleView> {
  const valid = validate(input);
  const last = await AutomationRule.max<number, AutomationRule>('run_order');
  let created: AutomationRule;

  await sequelize.transaction(async (transaction) => {
    created = await AutomationRule.create(
      {
        name: valid.name,
        trigger_key: valid.triggerKey,
        conditions_json: valid.conditions,
        actions_json: valid.actions,
        // ALWAYS CREATED DISABLED (FR-061). Saving a rule and running a rule
        // are two different acts, and the dry run exists to happen between
        // them.
        is_enabled: false,
        run_order: (Number(last) || 0) + 1,
        // The accountability record FR-086 attributes automated acts to.
        created_by_user_id: actor.id,
      },
      { transaction },
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.AUTOMATION_RULE_CREATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'automation_rule',
        targetId: created.id,
        targetLabel: created.name,
        newValue: valid,
        ...context,
      },
      transaction,
    );
  });

  return getRule(created!.id);
}

export async function updateRule(
  id: number,
  input: Record<string, unknown> & { version: unknown },
  actor: Actor,
  context: AuditContext = {},
): Promise<RuleView> {
  const rule = await AutomationRule.findByPk(id);
  if (!rule) throw notFound();

  const version = Number(input.version);

  if (!Number.isInteger(version) || version !== rule.version) {
    throw staleRecord();
  }

  const valid = validate(input, rule);
  const previous = {
    name: rule.name,
    triggerKey: rule.trigger_key,
    conditions: rule.conditions_json,
    actions: rule.actions_json,
  };

  await sequelize.transaction(async (transaction) => {
    rule.name = valid.name;
    rule.trigger_key = valid.triggerKey;
    rule.conditions_json = valid.conditions;
    rule.actions_json = valid.actions;

    await rule.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.AUTOMATION_RULE_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'automation_rule',
        targetId: rule.id,
        targetLabel: rule.name,
        previousValue: previous,
        newValue: valid,
        ...context,
      },
      transaction,
    );
  });

  return getRule(rule.id);
}

export async function setEnabled(
  id: number,
  isEnabled: boolean,
  actor: Actor,
  context: AuditContext = {},
): Promise<RuleView> {
  const rule = await AutomationRule.findByPk(id);
  if (!rule) throw notFound();

  if (rule.is_enabled !== isEnabled) {
    await sequelize.transaction(async (transaction) => {
      rule.is_enabled = isEnabled;
      await rule.save({ transaction });

      await auditService.record(
        {
          action: isEnabled
            ? auditService.AUDIT_ACTIONS.AUTOMATION_RULE_ENABLED
            : auditService.AUDIT_ACTIONS.AUTOMATION_RULE_DISABLED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'automation_rule',
          targetId: rule.id,
          targetLabel: rule.name,
          previousValue: { isEnabled: !isEnabled },
          newValue: { isEnabled },
          ...context,
        },
        transaction,
      );
    });
  }

  // FR-061: enabling does NOT act retroactively. Nothing here replays events
  // that occurred while the rule was off, and nothing should be added that does.
  return getRule(rule.id);
}

export async function reorderRules(
  ruleIds: unknown,
  actor: Actor,
  context: AuditContext = {},
): Promise<RuleView[]> {
  if (!Array.isArray(ruleIds)) {
    throw validationError([{ field: 'ruleIds', message: 'automation.error.orderInvalid' }]);
  }

  const ids = ruleIds.map(Number);
  const rules = await AutomationRule.findAll({ where: { id: { [Op.in]: ids } } });

  // The WHOLE sequence, in one transaction. A partial reorder would leave two
  // rules claiming the same position, and FR-060 requires the order to be
  // something a user can rely on.
  if (rules.length !== ids.length) {
    throw validationError([{ field: 'ruleIds', message: 'automation.error.orderInvalid' }]);
  }

  await sequelize.transaction(async (transaction) => {
    for (const [index, id] of ids.entries()) {
      await AutomationRule.update({ run_order: index + 1 }, { where: { id }, transaction });
    }

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.AUTOMATION_RULES_REORDERED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'automation_rule',
        targetId: null,
        targetLabel: 'run order',
        newValue: { ruleIds: ids },
        ...context,
      },
      transaction,
    );
  });

  return listRules();
}

/**
 * Rules ARE hard-deletable (FR-054), and `automation_runs` deliberately does
 * not cascade (FR-070): the record of what a rule already did outlives it, with
 * `rule_name` denormalised so it stays readable.
 */
export async function deleteRule(
  id: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const rule = await AutomationRule.findByPk(id);
  if (!rule) throw notFound();

  const snapshot = {
    name: rule.name,
    triggerKey: rule.trigger_key,
    conditions: rule.conditions_json,
    actions: rule.actions_json,
  };

  await sequelize.transaction(async (transaction) => {
    await rule.destroy({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.AUTOMATION_RULE_DELETED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'automation_rule',
        targetId: id,
        targetLabel: snapshot.name,
        previousValue: snapshot,
        ...context,
      },
      transaction,
    );
  });
}

/**
 * What a rule WOULD do (FR-066).
 *
 * `id` names a saved rule; an overriding body lets an unsaved one be checked
 * before it exists. Either way the definition is VALIDATED FIRST, so a dry run
 * cannot report on a rule the system would refuse to store — which would be a
 * confident answer about something that can never happen.
 */
export interface DryRunResult {
  sampleSize: number;
  matched: Array<{ ticket: { id: number; subject: string }; wouldApply: RuleAction[] }>;
  unmatchedCount: number;
}

export async function dryRunRule(
  id: number,
  overrides: Record<string, unknown>,
): Promise<DryRunResult> {
  const existing = Number.isInteger(id) ? await AutomationRule.findByPk(id) : null;

  if (!existing && Object.keys(overrides).length === 0) throw notFound();

  const valid = validate(overrides, existing ?? undefined);
  const engine = await import('./automation-engine.service.js');

  return engine.dryRun(valid.triggerKey, valid.conditions, valid.actions);
}

// --- The run record --------------------------------------------------------

export interface RunView {
  id: number;
  ruleId: number | null;
  ruleName: string;
  triggerKey: string;
  ticket: { id: number; reference: string } | null;
  outcome: string;
  depth: number;
  actionsApplied: unknown;
  detail: unknown;
  createdAt: Date;
}

export interface RunListOptions {
  ruleId?: unknown;
  ticketId?: unknown;
  outcome?: unknown;
  page?: unknown;
  pageSize?: unknown;
}

export async function listRuns(options: RunListOptions = {}): Promise<Paged<RunView>> {
  const { toReference } = await import('../tickets/reference.js');

  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 25));

  const where: Record<string, unknown> = {};

  if (options.ruleId !== undefined) where.rule_id = Number(options.ruleId);
  if (options.ticketId !== undefined) where.ticket_id = Number(options.ticketId);
  if (options.outcome !== undefined) where.outcome = String(options.outcome);

  const { rows, count } = await AutomationRun.findAndCountAll({
    where,
    order: [['id', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    items: rows.map((run) => ({
      id: run.id,
      // May be null while `ruleName` is always present — FR-070.
      ruleId: run.rule_id,
      ruleName: run.rule_name,
      triggerKey: run.trigger_key,
      ticket:
        run.ticket_id === null
          ? null
          : { id: run.ticket_id, reference: toReference(run.ticket_id) },
      outcome: run.outcome,
      depth: run.depth,
      actionsApplied: run.actions_applied,
      // Stored as JSON `{ key, params }` and rendered from its key by the
      // interface — never a sentence decided at write time.
      detail: run.detail === null ? null : safeParse(run.detail),
      createdAt: run.created_at,
    })),
    page,
    pageSize,
    total: count,
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Exported for the executor and its tests. */
export { AutomationRule, AutomationRun, Role, Ticket };
