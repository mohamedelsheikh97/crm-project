import bcrypt from 'bcrypt';

import {
  invalidCredentials,
  unauthenticated,
  validationError,
  type ErrorDetail,
} from '../errors/app-error.js';
import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { Role, User } from '../models/index.js';

import * as auditService from './audit.service.js';
import * as passwordService from './password.service.js';

import * as authorizationService from './authorization.service.js';

import { signAccessToken, signRefreshToken, verifyRefreshToken } from './token.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A real bcrypt hash of a value nobody knows. Comparing against it on the
 * "no such user" path keeps login's response time from distinguishing an
 * unknown account from a wrong password (US2 Scenario 7, quickstart V5).
 */
const DUMMY_HASH = '$2b$12$X8O3LLMKBxk1T/XaMJRjHeB9D5kxC1h.Q4HhCRcfcfQFSCNmsAjqG';

export interface AuthenticatedUser {
  id: number;
  email: string;
}

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}

export async function login(
  email: unknown,
  password: unknown,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<LoginResult> {
  const details: ErrorDetail[] = [];
  const normalisedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalisedEmail || !EMAIL_PATTERN.test(normalisedEmail)) {
    details.push({ field: 'email', message: 'A valid email address is required.' });
  }

  // Login checks non-empty only. A minimum-length rule here would tell an
  // attacker nothing while confusing a legitimate user with a short password;
  // the length rule belongs on password *writes*.
  if (typeof password !== 'string' || password.length === 0) {
    details.push({ field: 'password', message: 'A password is required.' });
  }

  if (details.length > 0) {
    throw validationError(details);
  }

  const user = await User.scope('withPassword').findOne({ where: { email: normalisedEmail } });

  if (!user) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    // Recorded even though no account matched, so probing is visible (FR-037).
    await recordFailure(null, normalisedEmail, context, 'unknown_account');
    throw invalidCredentials();
  }

  // Deactivated and locked accounts are refused BEFORE the password is checked,
  // but still run a bcrypt compare against the dummy hash first. Skipping the
  // hash would make these paths detectably faster and reintroduce the
  // enumeration leak through timing (FR-030, research.md D6).
  if (!user.is_active || user.isLocked) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    await recordFailure(user.id, user.email, context, user.is_active ? 'locked' : 'inactive');
    throw invalidCredentials();
  }

  const matches = await bcrypt.compare(String(password), user.password_hash);

  if (!matches) {
    // Identical error to every branch above — any difference in body, status,
    // or timing is an account-enumeration defect, not a cosmetic one.
    await registerFailedAttempt(user, context);
    await recordFailure(user.id, user.email, context, 'wrong_password');
    throw invalidCredentials();
  }

  await clearFailedAttempts(user);

  await auditService.recordAuthEvent({
    action: auditService.AUDIT_ACTIONS.LOGIN_SUCCESS,
    actorUserId: user.id,
    actorEmail: user.email,
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.email,
    ...context,
  });

  return {
    user: { id: user.id, email: user.email },
    accessToken: signAccessToken({ id: user.id, email: user.email }),
    refreshToken: signRefreshToken({ id: user.id }),
  };
}

/**
 * Returns a new access token only. No new refresh token is issued: the 7-day
 * window is absolute, not sliding, which bounds the damage from a stolen
 * refresh token (contracts/auth-api.md).
 */
export async function refresh(refreshToken: string): Promise<{ accessToken: string }> {
  const { id } = verifyRefreshToken(refreshToken);

  // The refresh token carries no email claim by design, so the identity for
  // the new access token is re-read from the database. A subject that no
  // longer resolves to a user is treated as unauthenticated.
  const user = await User.findByPk(id);

  if (!user) {
    throw unauthenticated();
  }

  return { accessToken: signAccessToken({ id: user.id, email: user.email }) };
}

export async function getUserById(id: number): Promise<User | null> {
  // Default scope, so password_hash cannot leak.
  return User.findByPk(id);
}

export interface CurrentUser {
  id: number;
  email: string;
  fullName: string;
  role: { key: string; nameKey: string };
  permissions: string[];
  mustChangePassword: boolean;
}

/**
 * What the interface needs to render correctly.
 *
 * `permissions` is the RESOLVED key set rather than the role name for the
 * client to expand, so there is one source of truth on the server and an
 * Administrator's edit is reflected as soon as the client refreshes its
 * session state (research.md D13).
 *
 * Reachable while must_change_password is set, so the frontend can read the
 * flag and route to the change screen.
 */
export async function getCurrentUser(id: number): Promise<CurrentUser | null> {
  const user = await User.findByPk(id, { include: [{ model: Role, as: 'role' }] });

  if (!user) {
    return null;
  }

  const role = (user as User & { role?: Role }).role;

  if (!role) {
    // The schema guarantees a role via a NOT NULL foreign key, so this is a
    // broken invariant rather than a user-facing condition.
    throw new Error(`User ${user.id} has no role.`);
  }

  const permissions = await authorizationService.getRolePermissions(user.role_id);

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: { key: role.key, nameKey: role.name_key },
    permissions: [...permissions].sort(),
    mustChangePassword: user.must_change_password,
  };
}

/**
 * The signed-in user changes their own password.
 *
 * Everything happens in one transaction: the new hash, clearing the forced
 * change flag, the history entry, and the audit record. If the audit write
 * fails, the password does not change either (FR-041).
 */
export async function changePassword(
  userId: number,
  currentPassword: unknown,
  newPassword: unknown,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const user = await User.scope('withPassword').findByPk(userId);

  if (!user) {
    throw unauthenticated();
  }

  // A failed credential check, not a malformed request — hence 401, not 400.
  if (
    typeof currentPassword !== 'string' ||
    !(await passwordService.verify(currentPassword, user.password_hash))
  ) {
    throw unauthenticated();
  }

  const failures = passwordService.validatePolicy(newPassword);

  if (failures.length > 0) {
    throw validationError(failures);
  }

  if (await passwordService.isReused(user.id, newPassword as string)) {
    throw validationError([{ field: 'newPassword', message: 'password.rule.reused' }]);
  }

  const passwordHash = await passwordService.hash(newPassword as string);

  await sequelize.transaction(async (transaction) => {
    user.password_hash = passwordHash;
    user.must_change_password = false;
    await user.save({ transaction });

    await passwordService.recordHistory(user.id, passwordHash, transaction);

    // Records THAT it happened, never what changed (FR-036).
    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PASSWORD_CHANGED,
        actorUserId: user.id,
        actorEmail: user.email,
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        ...context,
      },
      transaction,
    );
  });
}

/**
 * Increments the consecutive-failure counter and locks the account once the
 * configured threshold is reached (FR-026).
 *
 * The lock is never surfaced to the caller: a locked account returns the same
 * response as a wrong password and an unknown account, or the login form
 * becomes an account-existence oracle (FR-030, research.md D6).
 */
async function registerFailedAttempt(
  user: User,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  user.failed_login_attempts += 1;

  if (user.failed_login_attempts >= env.AUTH_MAX_FAILED_ATTEMPTS && !user.isLocked) {
    user.locked_until = new Date(Date.now() + env.AUTH_LOCKOUT_MINUTES * 60_000);

    await user.save();

    await auditService.recordAuthEvent({
      action: auditService.AUDIT_ACTIONS.ACCOUNT_LOCKED,
      outcome: 'failure',
      actorUserId: user.id,
      actorEmail: user.email,
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      metadata: { attempts: user.failed_login_attempts },
      ...context,
    });

    return;
  }

  await user.save();
}

/** A successful sign-in resets the counter and clears any expired lock (FR-029). */
async function clearFailedAttempts(user: User): Promise<void> {
  if (user.failed_login_attempts === 0 && user.locked_until === null) {
    return;
  }

  user.failed_login_attempts = 0;
  user.locked_until = null;
  await user.save();
}

/**
 * Every failed sign-in is recorded, including ones against identifiers that
 * match no account (FR-037). The reason is kept in metadata for an
 * investigator — it is never revealed to the caller, whose response is
 * identical in all four cases (FR-030).
 */
async function recordFailure(
  userId: number | null,
  email: string,
  context: { ipAddress?: string | null; userAgent?: string | null },
  reason: 'unknown_account' | 'wrong_password' | 'locked' | 'inactive',
): Promise<void> {
  await auditService.recordAuthEvent({
    action: auditService.AUDIT_ACTIONS.LOGIN_FAILURE,
    outcome: 'failure',
    actorUserId: userId,
    actorEmail: email,
    metadata: { reason },
    ...context,
  });
}

export interface SessionContext {
  id: number;
  email: string;
  roleId: number;
  isActive: boolean;
  mustChangePassword: boolean;
}

/**
 * The current authorization-relevant state of a user, read fresh on every
 * protected request (research.md D1).
 *
 * Exists so `authenticate` middleware does not import a model directly —
 * only services touch models (Constitution Principle III, FR-051). Returns
 * null when the user is missing OR inactive: both must produce the same 401,
 * so the middleware is not given enough information to distinguish them.
 */
export async function getSessionContext(id: number): Promise<SessionContext | null> {
  const user = await User.findByPk(id);

  if (!user || !user.is_active) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    roleId: user.role_id,
    isActive: user.is_active,
    mustChangePassword: user.must_change_password,
  };
}
