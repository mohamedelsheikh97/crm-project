import { Op, type Transaction, type WhereOptions } from 'sequelize';

import { sequelize } from '../config/database.js';
import {
  conflict,
  forbidden,
  notFound,
  staleRecord,
  validationError,
  type ErrorDetail,
} from '../errors/app-error.js';
import { Role, User } from '../models/index.js';

import * as auditService from './audit.service.js';
import * as authorizationService from './authorization.service.js';
import * as passwordService from './password.service.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Administrative access" means the ability to administer users. FR-009 and
 * FR-018 both hang off this: the system must never reach a state where nobody
 * can manage accounts.
 */
const ADMIN_CAPABILITY = 'users:update' as const;

export interface Actor {
  id: number;
  email: string;
}

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface UserView {
  id: number;
  email: string;
  fullName: string;
  role: { key: string; nameKey: string };
  isActive: boolean;
  isLocked: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  version: number;
}

function toView(user: User & { role?: Role }): UserView {
  if (!user.role) {
    throw new Error('User was loaded without its role.');
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: { key: user.role.key, nameKey: user.role.name_key },
    isActive: user.is_active,
    // Derived from locked_until, not stored — no second field to keep in sync.
    isLocked: user.isLocked,
    mustChangePassword: user.must_change_password,
    createdAt: user.created_at,
    version: user.version,
  };
}

/**
 * Clamped rather than rejected. A default alone would not stop a caller from
 * asking for the entire table (FR-040).
 */
export function clampPageSize(requested: unknown): number {
  const value = Number(requested);

  if (!Number.isFinite(value) || value < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.floor(value), MAX_PAGE_SIZE);
}

export interface ListOptions {
  page?: unknown;
  pageSize?: unknown;
  search?: string;
  roleKey?: string;
  isActive?: boolean;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export async function list(options: ListOptions = {}): Promise<Paged<UserView>> {
  const pageSize = clampPageSize(options.pageSize);
  const requestedPage = Number(options.page);
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;

  const where: WhereOptions = {};

  if (options.search) {
    Object.assign(where, {
      [Op.or]: [
        { email: { [Op.like]: '%' + options.search + '%' } },
        { full_name: { [Op.like]: '%' + options.search + '%' } },
      ],
    });
  }

  if (typeof options.isActive === 'boolean') {
    Object.assign(where, { is_active: options.isActive });
  }

  const { rows, count } = await User.findAndCountAll({
    where,
    include: [
      {
        model: Role,
        as: 'role',
        ...(options.roleKey ? { where: { key: options.roleKey } } : {}),
      },
    ],
    order: [['created_at', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  return {
    items: rows.map((row) => toView(row as User & { role?: Role })),
    page,
    pageSize,
    total: count,
  };
}

export async function getById(id: number): Promise<UserView> {
  const user = await User.findByPk(id, { include: [{ model: Role, as: 'role' }] });

  if (!user) {
    throw notFound();
  }

  return toView(user as User & { role?: Role });
}

async function roleByKey(key: string): Promise<Role> {
  const role = await Role.findOne({ where: { key } });

  if (!role) {
    throw validationError([{ field: 'roleKey', message: 'user.error.unknownRole' }]);
  }

  return role;
}

/**
 * Counts active users who would still hold administrative access AFTER a
 * proposed change.
 *
 * Asking "would this leave zero?" rather than "are there some now?" is what
 * makes FR-009 correct — the current state is never the question.
 */
async function countAdminsAfter(
  change: { userId: number; newRoleId?: number; nowActive?: boolean },
  transaction?: Transaction,
): Promise<number> {
  const adminRoleIds = await authorizationService.rolesGranting(ADMIN_CAPABILITY);

  if (adminRoleIds.length === 0) {
    return 0;
  }

  const others = await User.count({
    where: {
      id: { [Op.ne]: change.userId },
      is_active: true,
      role_id: { [Op.in]: adminRoleIds },
    },
    transaction,
  });

  const subject = await User.findByPk(change.userId, { transaction });

  if (!subject) {
    return others;
  }

  const resultingRoleId = change.newRoleId ?? subject.role_id;
  const resultingActive = change.nowActive ?? subject.is_active;
  const subjectStillCounts = resultingActive && adminRoleIds.includes(resultingRoleId);

  return others + (subjectStillCounts ? 1 : 0);
}

export interface CreateUserInput {
  email: unknown;
  fullName: unknown;
  roleKey: unknown;
  initialPassword: unknown;
}

export async function create(
  input: CreateUserInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<UserView> {
  const details: ErrorDetail[] = [];
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';

  if (!email || !EMAIL_PATTERN.test(email)) {
    details.push({ field: 'email', message: 'user.error.emailInvalid' });
  }

  if (!fullName) {
    details.push({ field: 'fullName', message: 'user.error.fullNameRequired' });
  }

  if (typeof input.roleKey !== 'string') {
    details.push({ field: 'roleKey', message: 'user.error.roleRequired' });
  }

  details.push(...passwordService.validatePolicy(input.initialPassword, 'initialPassword'));

  if (details.length > 0) {
    throw validationError(details);
  }

  const role = await roleByKey(input.roleKey as string);

  if (await User.findOne({ where: { email } })) {
    throw conflict('A user with this email already exists.', [
      { field: 'email', message: 'user.error.emailTaken' },
    ]);
  }

  const passwordHash = await passwordService.hash(input.initialPassword as string);

  // The audit insert shares this transaction: if it fails the user is not
  // created either, so an unrecorded account cannot exist (FR-041).
  const created = await sequelize.transaction(async (transaction) => {
    const user = await User.create(
      {
        email,
        full_name: fullName,
        password_hash: passwordHash,
        role_id: role.id,
        is_active: true,
        // Forced change on first sign-in (FR-010).
        must_change_password: true,
        failed_login_attempts: 0,
        locked_until: null,
      },
      { transaction },
    );

    await passwordService.recordHistory(user.id, passwordHash, transaction);

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.USER_CREATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        newValue: { email: user.email, fullName: user.full_name, roleKey: role.key },
        ...context,
      },
      transaction,
    );

    return user;
  });

  return getById(created.id);
}

export interface UpdateUserInput {
  fullName?: unknown;
  roleKey?: unknown;
  version: unknown;
}

export async function update(
  id: number,
  input: UpdateUserInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<UserView> {
  const user = await User.findByPk(id, { include: [{ model: Role, as: 'role' }] });

  if (!user) {
    throw notFound();
  }

  if (Number(input.version) !== user.version) {
    throw staleRecord();
  }

  const previousRole = (user as User & { role?: Role }).role;
  let nextRole = previousRole;

  if (typeof input.roleKey === 'string' && input.roleKey !== previousRole?.key) {
    nextRole = await roleByKey(input.roleKey);

    // A user must not strip their own administrative access — they would then
    // be unable to undo it (FR-008).
    if (actor.id === user.id) {
      const adminRoleIds = await authorizationService.rolesGranting(ADMIN_CAPABILITY);

      if (!adminRoleIds.includes(nextRole.id)) {
        throw forbidden();
      }
    }

    if ((await countAdminsAfter({ userId: user.id, newRoleId: nextRole.id })) === 0) {
      throw conflict('This change would leave the system with no administrator.');
    }
  }

  const previousValue = { fullName: user.full_name, roleKey: previousRole?.key };
  const roleChanged = Boolean(nextRole && nextRole.key !== previousRole?.key);

  await sequelize.transaction(async (transaction) => {
    if (typeof input.fullName === 'string' && input.fullName.trim()) {
      user.full_name = input.fullName;
    }

    if (nextRole) {
      user.role_id = nextRole.id;
    }

    await user.save({ transaction });

    await auditService.record(
      {
        action: roleChanged
          ? auditService.AUDIT_ACTIONS.USER_ROLE_CHANGED
          : auditService.AUDIT_ACTIONS.USER_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        previousValue,
        newValue: { fullName: user.full_name, roleKey: nextRole?.key },
        ...context,
      },
      transaction,
    );
  });

  return getById(user.id);
}

export async function setActive(
  id: number,
  active: boolean,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const user = await User.findByPk(id);

  if (!user) {
    throw notFound();
  }

  // Checked before the last-administrator rule, because "you cannot do this to
  // yourself" is the more specific and more useful answer (FR-008).
  if (!active && actor.id === user.id) {
    throw forbidden();
  }

  if (!active && (await countAdminsAfter({ userId: user.id, nowActive: false })) === 0) {
    throw conflict('This change would leave the system with no administrator.');
  }

  if (user.is_active === active) {
    return;
  }

  await sequelize.transaction(async (transaction) => {
    user.is_active = active;

    if (active) {
      user.failed_login_attempts = 0;
      user.locked_until = null;
    }

    await user.save({ transaction });

    await auditService.record(
      {
        action: active
          ? auditService.AUDIT_ACTIONS.USER_REACTIVATED
          : auditService.AUDIT_ACTIONS.USER_DEACTIVATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        previousValue: { isActive: !active },
        newValue: { isActive: active },
        ...context,
      },
      transaction,
    );
  });
}

/** Idempotent: unlocking an account that is not locked succeeds. */
export async function unlock(id: number, actor: Actor, context: AuditContext = {}): Promise<void> {
  const user = await User.findByPk(id);

  if (!user) {
    throw notFound();
  }

  await sequelize.transaction(async (transaction) => {
    user.failed_login_attempts = 0;
    user.locked_until = null;
    await user.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.ACCOUNT_UNLOCKED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        ...context,
      },
      transaction,
    );
  });
}

export async function resetPassword(
  id: number,
  newPassword: unknown,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const failures = passwordService.validatePolicy(newPassword);

  if (failures.length > 0) {
    throw validationError(failures);
  }

  const user = await User.findByPk(id);

  if (!user) {
    throw notFound();
  }

  const passwordHash = await passwordService.hash(newPassword as string);

  await sequelize.transaction(async (transaction) => {
    user.password_hash = passwordHash;
    // Forced change on next sign-in; any lock is released (FR-010).
    user.must_change_password = true;
    user.failed_login_attempts = 0;
    user.locked_until = null;
    await user.save({ transaction });

    await passwordService.recordHistory(user.id, passwordHash, transaction);

    // Records THAT it happened, never what changed (FR-036).
    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PASSWORD_RESET,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        ...context,
      },
      transaction,
    );
  });
}
