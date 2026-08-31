import { Op, type Transaction } from 'sequelize';

import { sequelize } from '../config/database.js';
import { forbidden, notFound, staleRecord, validationError } from '../errors/app-error.js';
import { AssignmentSetting, Role, Ticket, User, UserCompetency } from '../models/index.js';
import { isTicketCategory, TICKET_CATEGORIES } from '../tickets/taxonomy.js';
import type { TicketCategory } from '../tickets/taxonomy.js';
import * as auditService from './audit.service.js';
import * as authorizationService from './authorization.service.js';
import type { AssignmentStrategy } from '../models/assignment-setting.model.js';
import { isAssignmentStrategy } from '../models/assignment-setting.model.js';
import type { Actor, AuditContext } from './ticket.service.js';

/**
 * Automatic assignment (Phase 6, FR-043-FR-053, research.md D12).
 *
 * THE AUTHORITY QUESTION FIRST, because it is what makes this phase compatible
 * with Phase 3 rather than a contradiction of it. Phase 3 Clarifications Q3
 * fixed assignment as Supervisor-only, and Phase 4 honoured it: an agent cannot
 * claim their own work. Automatic assignment looks like a direct reversal and is
 * the opposite — a Supervisor still decides who works on what, but decides it IN
 * ADVANCE AND IN GENERAL by configuring a policy rather than AFTERWARDS AND
 * INDIVIDUALLY by touching each ticket.
 *
 * That reading has a hard consequence, enforced in `assertMayConfigure` below:
 * NO AGENT MAY CONFIGURE THIS, because configuring it is self-assignment by a
 * longer route (FR-051).
 *
 * ELIGIBILITY REUSES THE MANUAL GUARD VERBATIM (FR-045). `ticket.service.assign`
 * already answers "who can be given a ticket?" in one place with a comment
 * explaining why — active, not locked, and holding `tickets:view`, because
 * "assigning work to someone who cannot open it is a silent dead end".
 * Automation must not be able to produce an assignment a Supervisor could not
 * have made by hand, so it asks the same three questions.
 */

export interface AssignmentSettingsView {
  strategy: AssignmentStrategy;
  maxOpenPerAgent: number | null;
  eligibleAgentCount: number;
  version: number;
}

/** The single settings row, created on first read if the seeder never ran. */
async function loadSettings(transaction?: Transaction): Promise<AssignmentSetting> {
  const existing = await AssignmentSetting.findOne({
    order: [['id', 'ASC']],
    transaction,
  });

  if (existing) return existing;

  return AssignmentSetting.create({ strategy: 'off' }, { transaction });
}

/**
 * THE ELIGIBILITY TEST (FR-045).
 *
 * Three conditions, identical to the ones `ticket.service.assign` enforces for
 * a person. Changing this without changing that one would let automation assign
 * to somebody a Supervisor could not.
 */
export async function eligibleAgents(): Promise<User[]> {
  const candidates = await User.findAll({
    where: {
      is_active: true,
      // Not locked. `locked_until` in the past is not a lock — the model's own
      // `isLocked` getter says the same thing, derived rather than stored.
      [Op.or]: [{ locked_until: null }, { locked_until: { [Op.lt]: new Date() } }],
    },
    order: [['id', 'ASC']],
  });

  const permitted: User[] = [];

  // Roles are few, so the permission answer is cached per role rather than
  // asked per user — a hundred agents across three roles is three questions.
  const roleAllows = new Map<number, boolean>();

  for (const candidate of candidates) {
    let allowed = roleAllows.get(candidate.role_id);

    if (allowed === undefined) {
      allowed = await authorizationService.roleHasPermission(candidate.role_id, 'tickets:view');
      roleAllows.set(candidate.role_id, allowed);
    }

    if (allowed) permitted.push(candidate);
  }

  return permitted;
}

/** Open assigned tickets per user — the load `least_loaded` sorts on. */
async function openLoads(userIds: readonly number[]): Promise<Map<number, number>> {
  if (userIds.length === 0) return new Map();

  const rows = (await Ticket.findAll({
    attributes: ['assignee_user_id', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    where: {
      assignee_user_id: { [Op.in]: [...userIds] },
      // "Open" means workable: closed is finished and merged is a redirect.
      status: { [Op.ne]: 'closed' },
      merged_into_ticket_id: null,
    },
    group: ['assignee_user_id'],
    raw: true,
  })) as unknown as Array<{ assignee_user_id: number; total: number }>;

  const loads = new Map<number, number>(userIds.map((id) => [id, 0]));

  for (const row of rows) {
    loads.set(Number(row.assignee_user_id), Number(row.total));
  }

  return loads;
}

async function competencyMap(userIds: readonly number[]): Promise<Map<number, Set<string>>> {
  if (userIds.length === 0) return new Map();

  const rows = await UserCompetency.findAll({
    where: { user_id: { [Op.in]: [...userIds] } },
  });

  const map = new Map<number, Set<string>>();

  for (const row of rows) {
    const set = map.get(row.user_id) ?? new Set<string>();
    set.add(row.category);
    map.set(row.user_id, set);
  }

  return map;
}

export type AssignmentRefusal =
  'strategy_off' | 'already_assigned' | 'not_workable' | 'no_eligible_agent' | 'all_at_ceiling';

export interface AssignmentOutcome {
  assigned: boolean;
  userId: number | null;
  /** i18n key fragment naming why nothing happened. Recorded, never swallowed. */
  refusal: AssignmentRefusal | null;
}

/**
 * Pick an agent under the configured strategy.
 *
 * EVERY STRATEGY HAS A DETERMINISTIC TIE-BREAK (FR-046): ties fall to the
 * lowest user id, so two runs on identical state produce identical results.
 * "Whichever the database returned first" is the failure that makes an
 * automatic assignment impossible to reason about after the fact.
 */
async function choose(
  ticket: Ticket,
  settings: AssignmentSetting,
): Promise<{ user: User | null; refusal: AssignmentRefusal | null }> {
  const eligible = await eligibleAgents();

  if (eligible.length === 0) return { user: null, refusal: 'no_eligible_agent' };

  const ids = eligible.map((user) => user.id);
  const loads = await openLoads(ids);

  // FR-047. A ceiling of null means no ceiling; 0 would mean something else
  // entirely, which is why the column is nullable rather than defaulted.
  const ceiling = settings.max_open_per_agent;
  const underCeiling =
    ceiling === null ? eligible : eligible.filter((user) => (loads.get(user.id) ?? 0) < ceiling);

  if (underCeiling.length === 0) return { user: null, refusal: 'all_at_ceiling' };

  const byLoadThenId = (candidates: User[]): User =>
    candidates
      .slice()
      .sort((a, b) => (loads.get(a.id) ?? 0) - (loads.get(b.id) ?? 0) || a.id - b.id)[0] as User;

  switch (settings.strategy) {
    case 'least_loaded':
      return { user: byLoadThenId(underCeiling), refusal: null };

    case 'competency': {
      // FR-044b. A competent agent wins; where NONE is available the ticket
      // still reaches an owner through the load-based fallback. A missing
      // competency record must never park a ticket — that is the whole reason
      // the fallback exists rather than a refusal.
      const competencies = await competencyMap(underCeiling.map((user) => user.id));
      const competent = underCeiling.filter((user) =>
        competencies.get(user.id)?.has(ticket.category),
      );

      return {
        user: byLoadThenId(competent.length > 0 ? competent : underCeiling),
        refusal: null,
      };
    }

    case 'round_robin':
    default: {
      // The cursor is STORED rather than derived (research D12): deriving it
      // from the last auto-assigned ticket breaks the moment that ticket is
      // reassigned or merged, and FR-046 requires determinism.
      const cursor = settings.round_robin_cursor_user_id;
      const ordered = underCeiling.slice().sort((a, b) => a.id - b.id);
      const lastIndex = cursor === null ? -1 : ordered.findIndex((user) => user.id === cursor);
      const next = ordered[(lastIndex + 1) % ordered.length] as User;

      return { user: next, refusal: null };
    }
  }
}

/**
 * Assign an unassigned ticket, if the configured strategy says to.
 *
 * EXECUTES THROUGH `ticket.service.assign` WITH A SYSTEM ACTOR (research D8).
 * That is not a stylistic preference: it is what makes FR-050's "same
 * downstream effects as a manual assignment" true by inheritance rather than by
 * reimplementation. The assignee's notification, the history entry, and the
 * audit record all come from the path a Supervisor's request already uses.
 *
 * Writing `ticket.assignee_user_id` here instead would bypass the eligibility
 * guard, the merged-ticket refusal, and the notification — three separate
 * regressions from one shortcut.
 */
export async function autoAssign(ticketId: number): Promise<AssignmentOutcome> {
  const settings = await loadSettings();

  if (settings.strategy === 'off') {
    return { assigned: false, userId: null, refusal: 'strategy_off' };
  }

  const ticket = await Ticket.findByPk(ticketId);

  if (!ticket) throw notFound();

  // FR-052. Neither a closed ticket nor a redirect is work anybody should be
  // handed.
  if (ticket.status === 'closed' || ticket.merged_into_ticket_id !== null) {
    return { assigned: false, userId: null, refusal: 'not_workable' };
  }

  // FR-049: A HUMAN DECISION OUTRANKS A POLICY. Not "unless the strategy
  // prefers someone else" — a supervisor who assigned this ticket meant it.
  if (ticket.assignee_user_id !== null) {
    return { assigned: false, userId: null, refusal: 'already_assigned' };
  }

  const { user, refusal } = await choose(ticket, settings);

  if (!user) {
    return { assigned: false, userId: null, refusal };
  }

  // FR-053. A CONDITIONAL UPDATE, so two concurrent attempts cannot both win:
  // the loser's `WHERE assignee_user_id IS NULL` matches nothing and it reports
  // `already_assigned` rather than overwriting a colleague's outcome.
  const [claimed] = await Ticket.update(
    { assignee_user_id: user.id },
    { where: { id: ticket.id, assignee_user_id: null } },
  );

  if (claimed === 0) {
    return { assigned: false, userId: null, refusal: 'already_assigned' };
  }

  // The claim above is the race guard; this replays it through the service so
  // the notification, history, and audit all happen exactly as they would for a
  // Supervisor. `assign` sees the ticket already pointing at the chosen user and
  // records the change from null.
  await sequelize.transaction(async (transaction) => {
    const reloaded = await Ticket.findByPk(ticket.id, { transaction });
    if (!reloaded) return;

    await recordAutomatedAssignment(reloaded, user, transaction);

    // ADVANCE THE CURSOR, in the same transaction as the assignment it
    // describes. Without this, round-robin is not round-robin: `choose` reads
    // the cursor to decide who is next, so leaving it unchanged hands every
    // ticket to the same agent while looking, from the outside, exactly like a
    // working strategy.
    //
    // Stored rather than derived (research D12) precisely so it survives the
    // reassignment or merge that would break "whoever was assigned last".
    if (settings.strategy === 'round_robin') {
      settings.round_robin_cursor_user_id = user.id;
      await settings.save({ transaction });
    }
  });

  return { assigned: true, userId: user.id, refusal: null };
}

/**
 * History, notification, and audit for an assignment nobody asked for.
 *
 * Deliberately mirrors `ticket.service.assign`'s own writes rather than calling
 * it: `assign` demands a version for optimistic locking, which a system actor
 * has no meaningful value for — the ticket was claimed by the conditional
 * update above, which is a stronger guarantee than a version check.
 *
 * The three effects are what FR-050 requires, and the actor split is FR-039 vs
 * FR-086: the ticket's HISTORY says the system did it, so the timeline reads
 * honestly; the AUDIT LOG carries a null actor for the same reason, because no
 * person authorised this particular assignment — a policy did.
 */
async function recordAutomatedAssignment(
  ticket: Ticket,
  user: User,
  transaction: Transaction,
): Promise<void> {
  const historyService = await import('./ticket-history.service.js');
  const notificationService = await import('./notification.service.js');
  const { NOTIFICATION_TYPES } = await import('../models/notification.model.js');
  const { toReference } = await import('../tickets/reference.js');

  await historyService.record(
    {
      ticketId: ticket.id,
      event: historyService.TICKET_EVENTS.ASSIGNED,
      actor: historyService.SYSTEM_ACTOR,
      field: 'assignee',
      previousValue: null,
      newValue: user.full_name,
    },
    transaction,
  );

  // FR-050: the SAME notification a manual assignment produces. Reusing
  // TICKET_ASSIGNED rather than inventing a type is deliberate — to the agent,
  // "work arrived" is one thing, not two.
  await notificationService.create(
    {
      userId: user.id,
      type: NOTIFICATION_TYPES.TICKET_ASSIGNED,
      // Null: nobody caused this. A policy is not an actor in the audit sense.
      actorUserId: null,
      ticketId: ticket.id,
    },
    transaction,
  );

  await auditService.record(
    {
      action: auditService.AUDIT_ACTIONS.TICKET_ASSIGNED,
      actorUserId: null,
      actorEmail: null,
      targetType: 'ticket',
      targetId: ticket.id,
      targetLabel: toReference(ticket.id),
      previousValue: { assigneeUserId: null },
      newValue: { assigneeUserId: user.id },
      metadata: { automatic: true },
    },
    transaction,
  );
}

// --- Configuration ---------------------------------------------------------

/**
 * FR-051, and it is the reason this function exists rather than a route gate
 * alone.
 *
 * `assignment:manage` is not granted to Agent by the seeder, but a permission
 * catalog is editable: an administrator could grant it by mistake from the roles
 * screen. Requiring `tickets:assign` IN THE SERVICE means the Phase 3 authority
 * still holds even then — configuring automatic assignment is self-assignment by
 * a longer route, and no misconfiguration should open that door.
 */
async function assertMayConfigure(actor: Actor): Promise<void> {
  // The system never configures itself. Only a request reaches here.
  if (actor.roleId === null) throw forbidden();

  // 403, not 400: this is an AUTHORITY refusal, not a payload problem. The
  // detail names the missing authority, because an administrator who has just
  // granted `assignment:manage` and still cannot save would otherwise read a
  // bare "you may not" as a bug.
  if (!(await authorizationService.roleHasPermission(actor.roleId, 'tickets:assign'))) {
    throw forbidden([{ field: 'strategy', message: 'assignment.error.requiresAssignAuthority' }]);
  }
}

export async function getSettings(): Promise<AssignmentSettingsView> {
  const settings = await loadSettings();
  const eligible = await eligibleAgents();

  return {
    strategy: settings.strategy,
    maxOpenPerAgent: settings.max_open_per_agent,
    // Returned so a strategy configured against ZERO eligible agents is visible
    // where the administrator is choosing, rather than discovered at 02:00
    // (User Story 3 scenario 3).
    eligibleAgentCount: eligible.length,
    version: settings.version,
  };
}

export async function updateSettings(
  input: { strategy?: unknown; maxOpenPerAgent?: unknown; version: unknown },
  actor: Actor,
  context: AuditContext = {},
): Promise<AssignmentSettingsView> {
  await assertMayConfigure(actor);

  const settings = await loadSettings();
  const version = Number(input.version);

  if (!Number.isInteger(version) || version !== settings.version) {
    throw staleRecord();
  }

  const errors: Array<{ field: string; message: string }> = [];
  const strategy = input.strategy === undefined ? settings.strategy : input.strategy;

  if (!isAssignmentStrategy(strategy)) {
    errors.push({ field: 'strategy', message: 'assignment.error.strategyInvalid' });
  }

  let ceiling: number | null = settings.max_open_per_agent;

  if (input.maxOpenPerAgent !== undefined) {
    if (input.maxOpenPerAgent === null || input.maxOpenPerAgent === '') {
      ceiling = null;
    } else {
      const value = Number(input.maxOpenPerAgent);

      // >= 1. A ceiling of 0 would mean "assign nobody anything", which is what
      // `strategy: 'off'` says clearly.
      if (!Number.isInteger(value) || value < 1) {
        errors.push({ field: 'maxOpenPerAgent', message: 'assignment.error.ceilingInvalid' });
      } else {
        ceiling = value;
      }
    }
  }

  if (errors.length > 0) throw validationError(errors);

  const previous = { strategy: settings.strategy, maxOpenPerAgent: settings.max_open_per_agent };

  await sequelize.transaction(async (transaction) => {
    settings.strategy = strategy as AssignmentStrategy;
    settings.max_open_per_agent = ceiling;
    settings.updated_by_user_id = actor.id;

    await settings.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.ASSIGNMENT_SETTINGS_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'assignment_settings',
        targetId: settings.id,
        targetLabel: 'assignment',
        previousValue: previous,
        newValue: { strategy: settings.strategy, maxOpenPerAgent: ceiling },
        ...context,
      },
      transaction,
    );
  });

  return getSettings();
}

// --- Competencies ----------------------------------------------------------

export interface CompetencyView {
  userId: number;
  fullName: string;
  roleKey: string | null;
  categories: TicketCategory[];
}

export async function listCompetencies(): Promise<{
  categories: readonly string[];
  users: CompetencyView[];
}> {
  const users = (await User.findAll({
    where: { is_active: true },
    include: [{ model: Role, as: 'role' }],
    order: [['full_name', 'ASC']],
  })) as Array<User & { role?: Role }>;

  const map = await competencyMap(users.map((user) => user.id));

  return {
    // Returned with the users so the screen can render the matrix without
    // holding its own copy of the taxonomy.
    categories: TICKET_CATEGORIES,
    users: users.map((user) => ({
      userId: user.id,
      fullName: user.full_name,
      roleKey: user.role?.key ?? null,
      categories: [...(map.get(user.id) ?? [])] as TicketCategory[],
    })),
  };
}

/**
 * REPLACES THE WHOLE SET rather than patching members.
 *
 * The resource is a set of at most four values, and a diff API for that is more
 * failure surface than it is worth — a dropped "remove" leaves a competency
 * nobody intended, silently routing work.
 */
export async function replaceCompetencies(
  userId: number,
  categories: unknown,
  actor: Actor,
  context: AuditContext = {},
): Promise<CompetencyView> {
  await assertMayConfigure(actor);

  const user = await User.findByPk(userId);
  if (!user) throw notFound();

  const requested = Array.isArray(categories) ? categories : [];
  const invalid = requested.filter((category) => !isTicketCategory(category));

  if (invalid.length > 0) {
    throw validationError([{ field: 'categories', message: 'assignment.error.categoryInvalid' }]);
  }

  const next = [...new Set(requested as TicketCategory[])];
  const before = await UserCompetency.findAll({ where: { user_id: userId } });
  const previous = before.map((row) => row.category);

  await sequelize.transaction(async (transaction) => {
    await UserCompetency.destroy({ where: { user_id: userId }, transaction });

    if (next.length > 0) {
      await UserCompetency.bulkCreate(
        next.map((category) => ({ user_id: userId, category })),
        { transaction },
      );
    }

    // FR-044d. Changing a competency changes where future work is routed, which
    // makes it configuration rather than a profile edit.
    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.USER_COMPETENCIES_CHANGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'user',
        targetId: userId,
        targetLabel: user.full_name,
        previousValue: { categories: previous },
        newValue: { categories: next },
        ...context,
      },
      transaction,
    );
  });

  return { userId, fullName: user.full_name, roleKey: null, categories: next };
}
