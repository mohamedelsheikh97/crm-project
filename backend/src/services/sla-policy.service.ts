import { Op } from 'sequelize';

import { sequelize } from '../config/database.js';
import { notFound, staleRecord, validationError } from '../errors/app-error.js';
import { SlaPolicy, Ticket } from '../models/index.js';
import { PRECEDENCE_ORDER, scopeLabelKey, specificityOf } from '../sla/precedence.js';
import { isTicketCategory, isTicketPriority } from '../tickets/taxonomy.js';
import type { TicketCategory, TicketPriority } from '../tickets/taxonomy.js';
import * as auditService from './audit.service.js';
import type { Actor, AuditContext } from './ticket.service.js';

/**
 * SLA policies: CRUD, and the match that decides which one governs a ticket
 * (Phase 6, FR-001-FR-013).
 *
 * THE LIST ORDER IS THE PRECEDENCE ORDER. `list()` and `matchFor()` use the
 * same `PRECEDENCE_ORDER` from sla/precedence.ts, so the screen an
 * administrator reads demonstrates precedence rather than describing it — and
 * the two cannot drift into disagreeing.
 */

export interface PolicyView {
  id: number;
  name: string;
  nameAr: string | null;
  priority: TicketPriority | null;
  category: TicketCategory | null;
  responseMinutes: number;
  resolutionMinutes: number;
  isActive: boolean;
  specificity: number;
  /** i18n key describing what it matches, for the screen (Principle I). */
  matchesLabelKey: string;
  version: number;
}

function toView(policy: SlaPolicy): PolicyView {
  return {
    id: policy.id,
    name: policy.name,
    nameAr: policy.name_ar,
    priority: policy.priority,
    category: policy.category,
    responseMinutes: policy.response_minutes,
    resolutionMinutes: policy.resolution_minutes,
    isActive: policy.is_active,
    specificity: policy.specificity,
    matchesLabelKey: scopeLabelKey({ priority: policy.priority, category: policy.category }),
    version: policy.version,
  };
}

/** Every policy, IN THE ORDER THEY ARE MATCHED (FR-013). */
export async function list(): Promise<PolicyView[]> {
  const policies = await SlaPolicy.findAll({ order: [...PRECEDENCE_ORDER] });
  return policies.map(toView);
}

export async function getById(id: number): Promise<PolicyView> {
  const policy = await SlaPolicy.findByPk(id);
  if (!policy) throw notFound();
  return toView(policy);
}

/**
 * THE MATCHER (FR-010, FR-013).
 *
 * Returns the single governing policy, or null when none matches — and null is
 * a legitimate answer, not an error: FR-014 requires a ticket matching no
 * policy to be accepted, carry no target, and never be reported as breaching
 * one. That is why `ticket_sla` has no row for such a ticket at all.
 *
 * Deterministic and total by construction: `specificity DESC, updated_at DESC,
 * id DESC` cannot tie, so "whichever the database returned first" is never the
 * answer.
 */
export async function matchFor(scope: {
  priority: TicketPriority;
  category: TicketCategory;
}): Promise<SlaPolicy | null> {
  return SlaPolicy.findOne({
    where: {
      is_active: true,
      // NULL means "any", so a policy matches when its column is null OR equal.
      [Op.and]: [
        { [Op.or]: [{ priority: null }, { priority: scope.priority }] },
        { [Op.or]: [{ category: null }, { category: scope.category }] },
      ],
    },
    order: [...PRECEDENCE_ORDER],
  });
}

export interface PolicyInput {
  name?: unknown;
  nameAr?: unknown;
  priority?: unknown;
  category?: unknown;
  responseMinutes?: unknown;
  resolutionMinutes?: unknown;
}

interface ValidatedPolicy {
  name: string;
  nameAr: string | null;
  priority: TicketPriority | null;
  category: TicketCategory | null;
  responseMinutes: number;
  resolutionMinutes: number;
}

function validate(input: PolicyInput, current?: SlaPolicy): ValidatedPolicy {
  const errors: Array<{ field: string; message: string }> = [];

  const name = String(input.name ?? current?.name ?? '').trim();

  if (name === '') {
    errors.push({ field: 'name', message: 'sla.error.nameRequired' });
  }

  const nameArRaw = input.nameAr === undefined ? (current?.name_ar ?? null) : input.nameAr;
  const nameAr =
    nameArRaw === null || nameArRaw === undefined ? null : String(nameArRaw).trim() || null;

  const priorityRaw = input.priority === undefined ? (current?.priority ?? null) : input.priority;
  const categoryRaw = input.category === undefined ? (current?.category ?? null) : input.category;

  let priority: TicketPriority | null = null;
  let category: TicketCategory | null = null;

  if (priorityRaw !== null && priorityRaw !== undefined && priorityRaw !== '') {
    if (!isTicketPriority(priorityRaw)) {
      errors.push({ field: 'priority', message: 'sla.error.priorityInvalid' });
    } else {
      priority = priorityRaw;
    }
  }

  if (categoryRaw !== null && categoryRaw !== undefined && categoryRaw !== '') {
    if (!isTicketCategory(categoryRaw)) {
      errors.push({ field: 'category', message: 'sla.error.categoryInvalid' });
    } else {
      category = categoryRaw;
    }
  }

  const responseMinutes = Number(
    input.responseMinutes === undefined ? current?.response_minutes : input.responseMinutes,
  );
  const resolutionMinutes = Number(
    input.resolutionMinutes === undefined ? current?.resolution_minutes : input.resolutionMinutes,
  );

  const positive = (value: number): boolean => Number.isInteger(value) && value >= 1;

  if (!positive(responseMinutes)) {
    errors.push({ field: 'responseMinutes', message: 'sla.error.durationInvalid' });
  }

  if (!positive(resolutionMinutes)) {
    errors.push({ field: 'resolutionMinutes', message: 'sla.error.durationInvalid' });
  }

  // FR-008. A resolution target shorter than its own first-response target is a
  // promise that contradicts itself: the matter would be due resolved before a
  // reply was owed.
  if (
    positive(responseMinutes) &&
    positive(resolutionMinutes) &&
    resolutionMinutes < responseMinutes
  ) {
    errors.push({
      field: 'resolutionMinutes',
      message: 'sla.error.resolutionShorterThanResponse',
    });
  }

  if (errors.length > 0) throw validationError(errors);

  return { name, nameAr, priority, category, responseMinutes, resolutionMinutes };
}

export async function create(
  input: PolicyInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<PolicyView> {
  const valid = validate(input);
  let created: SlaPolicy;

  await sequelize.transaction(async (transaction) => {
    created = await SlaPolicy.create(
      {
        name: valid.name,
        name_ar: valid.nameAr,
        priority: valid.priority,
        category: valid.category,
        response_minutes: valid.responseMinutes,
        resolution_minutes: valid.resolutionMinutes,
        is_active: true,
        // DERIVED, never accepted from the client: a caller who could set it
        // could jump the queue past every other policy.
        specificity: specificityOf({ priority: valid.priority, category: valid.category }),
        created_by_user_id: actor.id,
      },
      { transaction },
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.SLA_POLICY_CREATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'sla_policy',
        targetId: created.id,
        targetLabel: created.name,
        newValue: valid,
        ...context,
      },
      transaction,
    );
  });

  return toView(created!);
}

export async function update(
  id: number,
  input: PolicyInput & { version: unknown },
  actor: Actor,
  context: AuditContext = {},
): Promise<PolicyView> {
  const policy = await SlaPolicy.findByPk(id);
  if (!policy) throw notFound();

  const version = Number(input.version);

  if (!Number.isInteger(version) || version !== policy.version) {
    throw staleRecord();
  }

  const valid = validate(input, policy);
  const previous = {
    name: policy.name,
    priority: policy.priority,
    category: policy.category,
    responseMinutes: policy.response_minutes,
    resolutionMinutes: policy.resolution_minutes,
  };

  await sequelize.transaction(async (transaction) => {
    policy.name = valid.name;
    policy.name_ar = valid.nameAr;
    policy.priority = valid.priority;
    policy.category = valid.category;
    policy.response_minutes = valid.responseMinutes;
    policy.resolution_minutes = valid.resolutionMinutes;
    policy.specificity = specificityOf({ priority: valid.priority, category: valid.category });

    await policy.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.SLA_POLICY_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'sla_policy',
        targetId: policy.id,
        targetLabel: policy.name,
        previousValue: previous,
        newValue: valid,
        ...context,
      },
      transaction,
    );
  });

  // FR-018 IS AN ABSENCE, and it is deliberate: nothing here recomputes the
  // targets of tickets already open under this policy. Live tickets keep the
  // promise made when they were raised; only a change to the TICKET (FR-017)
  // recomputes. Do not add a sweep here.
  return toView(policy);
}

export async function setActive(
  id: number,
  isActive: boolean,
  actor: Actor,
  context: AuditContext = {},
): Promise<{ policy: PolicyView; warning: string | null }> {
  const policy = await SlaPolicy.findByPk(id);
  if (!policy) throw notFound();

  if (policy.is_active !== isActive) {
    await sequelize.transaction(async (transaction) => {
      policy.is_active = isActive;
      await policy.save({ transaction });

      await auditService.record(
        {
          action: isActive
            ? auditService.AUDIT_ACTIONS.SLA_POLICY_ACTIVATED
            : auditService.AUDIT_ACTIONS.SLA_POLICY_DEACTIVATED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'sla_policy',
          targetId: policy.id,
          targetLabel: policy.name,
          previousValue: { isActive: !isActive },
          newValue: { isActive },
          ...context,
        },
        transaction,
      );
    });
  }

  // A WARNING, NEVER A REFUSAL. FR-014 makes "no policy" a valid state, so
  // deactivating the last catch-all must be allowed — refusing it would stop an
  // administrator switching the feature off.
  const remainingCatchAll = await SlaPolicy.count({
    where: { is_active: true, priority: null, category: null },
  });

  return {
    policy: toView(policy),
    warning: remainingCatchAll === 0 ? 'sla.warning.noCatchAllPolicy' : null,
  };
}

/** How many open tickets a policy currently governs, for the screen. */
export async function openTicketCounts(): Promise<Map<number, number>> {
  const rows = (await sequelize.query(
    `SELECT ts.policy_id AS policyId, COUNT(*) AS total
       FROM ticket_sla ts
       JOIN tickets t ON t.id = ts.ticket_id
      WHERE ts.policy_id IS NOT NULL
        AND t.status <> 'closed'
        AND t.merged_into_ticket_id IS NULL
      GROUP BY ts.policy_id`,
    { type: 'SELECT' },
  )) as Array<{ policyId: number; total: number }>;

  return new Map(rows.map((row) => [Number(row.policyId), Number(row.total)]));
}

/** Exported so tests can assert the matcher without reaching into the model. */
export { Ticket as TicketModelForTests };
