import type { Request } from 'express';
import type { Transaction } from 'sequelize';

import { AuditLog, type AuditOutcome } from '../models/audit-log.model.js';
import { logger } from '../middleware/request-logger.js';

/**
 * Every security-relevant event key (FR-032). `data.exported` and
 * `record.deleted` have no callers yet — the modules that export and delete
 * arrive in later phases. They are defined here so those phases record in the
 * established shape rather than inventing their own.
 */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password.changed',
  PASSWORD_RESET: 'auth.password.reset',
  ACCOUNT_LOCKED: 'auth.account.locked',
  ACCOUNT_UNLOCKED: 'auth.account.unlocked',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_REACTIVATED: 'user.reactivated',
  USER_ROLE_CHANGED: 'user.role.changed',
  ROLE_PERMISSIONS_CHANGED: 'role.permissions.changed',
  DATA_EXPORTED: 'data.exported',
  RECORD_DELETED: 'record.deleted',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * Keys stripped from every JSON field before it is stored. A careless caller
 * must not be able to leak a credential through `metadata` (FR-036).
 */
const REDACTED_KEYS = new Set(
  [
    'password',
    'newpassword',
    'currentpassword',
    'initialpassword',
    'passwordhash',
    'password_hash',
    'hash',
    'token',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'cookie',
    'authorization',
    'secret',
  ].map((key) => key.toLowerCase()),
);

/** Recursively strips sensitive keys. Applied to every JSON column on write. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  const output: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''))
      ? '[REDACTED]'
      : redact(nested, depth + 1);
  }

  return output;
}

export interface AuditEntry {
  action: AuditAction;
  outcome?: AuditOutcome;
  actorUserId?: number | null;
  actorEmail?: string | null;
  targetType?: string | null;
  targetId?: string | number | null;
  targetLabel?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
}

function toRow(entry: AuditEntry) {
  return {
    action: entry.action,
    outcome: entry.outcome ?? ('success' as AuditOutcome),
    actor_user_id: entry.actorUserId ?? null,
    actor_email: entry.actorEmail ?? null,
    target_type: entry.targetType ?? null,
    target_id:
      entry.targetId === undefined || entry.targetId === null ? null : String(entry.targetId),
    target_label: entry.targetLabel ?? null,
    ip_address: entry.ipAddress ?? null,
    user_agent: entry.userAgent ? entry.userAgent.slice(0, 255) : null,
    previous_value: entry.previousValue === undefined ? null : redact(entry.previousValue),
    new_value: entry.newValue === undefined ? null : redact(entry.newValue),
    metadata: entry.metadata === undefined ? null : redact(entry.metadata),
  };
}

/**
 * For state changes. REQUIRES a transaction — the audit insert shares the
 * transaction of the change it records, so "it happened but was not recorded"
 * is unrepresentable. If this write fails, the caller's transaction rolls back
 * (FR-041, research.md D4).
 */
export async function record(entry: AuditEntry, transaction: Transaction): Promise<void> {
  await AuditLog.create(toRow(entry), { transaction });
}

/**
 * For authentication-path events, which cannot honestly be transactional: a
 * failed sign-in has already failed, and rolling back would not un-attempt it.
 * Never throws — a failure logs at `error` with the full event instead, so the
 * gap is loud rather than silent (research.md D4).
 */
export async function recordAuthEvent(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create(toRow(entry));
  } catch (error) {
    logger.error(
      { err: error, auditEntry: toRow(entry) },
      'AUDIT WRITE FAILED — a security event was not recorded',
    );
  }
}

/** Request context every audit call needs, extracted in one place. */
export function auditContextFrom(req: Request): Pick<AuditEntry, 'ipAddress' | 'userAgent'> {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}
