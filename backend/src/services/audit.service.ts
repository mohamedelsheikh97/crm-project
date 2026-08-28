import type { Request } from 'express';
import { Op, col, fn, type Transaction } from 'sequelize';

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
  // Phase 2 — customer events.
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DEACTIVATED: 'customer.deactivated',
  CUSTOMER_REACTIVATED: 'customer.reactivated',
  CUSTOMER_DUPLICATE_OVERRIDDEN: 'customer.duplicate.overridden',
  CUSTOMER_NOTE_CREATED: 'customer.note.created',
  CUSTOMER_NOTE_UPDATED: 'customer.note.updated',
  CUSTOMER_NOTE_DELETED: 'customer.note.deleted',
  CUSTOMER_ATTACHMENT_UPLOADED: 'customer.attachment.uploaded',
  CUSTOMER_ATTACHMENT_DELETED: 'customer.attachment.deleted',

  // Phase 3 — ticket events. Closing and reopening get their own keys rather
  // than folding into ticket.status.changed, so an administrator scanning for
  // "what was undone" does not have to read the values of every status change.
  TICKET_CREATED: 'ticket.created',
  TICKET_UPDATED: 'ticket.updated',
  TICKET_STATUS_CHANGED: 'ticket.status.changed',
  TICKET_ASSIGNED: 'ticket.assigned',
  TICKET_UNASSIGNED: 'ticket.unassigned',
  TICKET_ESCALATED: 'ticket.escalated',
  TICKET_DEESCALATED: 'ticket.deescalated',
  TICKET_CLOSED: 'ticket.closed',
  TICKET_REOPENED: 'ticket.reopened',
  TICKET_MERGED: 'ticket.merged',
  TICKET_LINKED: 'ticket.linked',
  TICKET_UNLINKED: 'ticket.unlinked',

  // Defined in Phase 1 with no caller; Phase 2 is the first phase that
  // exports business records, so this finally acquires one.
  DATA_EXPORTED: 'data.exported',
  // Phase 3 gives this one a caller too: a merge permanently removes a record
  // a user created from active use, which is exactly what the key means. The
  // row is retained so references stay valid — the deletion is of its
  // workability, not of its bytes (research.md D8).
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

export interface AuditListOptions {
  page?: unknown;
  pageSize?: unknown;
  from?: string;
  to?: string;
  actorUserId?: number;
  action?: string;
  outcome?: AuditOutcome;
}

export interface AuditEntryView {
  id: number;
  action: string;
  actor: { id: number | null; email: string | null } | null;
  target: { type: string | null; id: string | null; label: string | null };
  outcome: AuditOutcome;
  ipAddress: string | null;
  previousValue: unknown;
  newValue: unknown;
  metadata: unknown;
  createdAt: Date;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function list(options: AuditListOptions = {}): Promise<{
  items: AuditEntryView[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const requestedSize = Number(options.pageSize);
  const pageSize =
    Number.isFinite(requestedSize) && requestedSize >= 1
      ? Math.min(Math.floor(requestedSize), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const requestedPage = Number(options.page);
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;

  const where: Record<string | symbol, unknown> = {};

  if (options.action) where.action = options.action;
  if (options.outcome) where.outcome = options.outcome;
  if (typeof options.actorUserId === 'number') where.actor_user_id = options.actorUserId;

  if (options.from || options.to) {
    const range: Record<symbol, Date> = {};
    if (options.from) range[Op.gte] = new Date(options.from);
    if (options.to) range[Op.lte] = new Date(options.to);
    where.created_at = range;
  }

  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    // Most recent first (FR-039).
    order: [['created_at', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      action: row.action,
      // Null for events with no authenticated actor — a failed sign-in against
      // an unknown identifier (FR-037). actor_email preserves what was tried.
      actor:
        row.actor_user_id === null && row.actor_email === null
          ? null
          : { id: row.actor_user_id, email: row.actor_email },
      target: { type: row.target_type, id: row.target_id, label: row.target_label },
      outcome: row.outcome,
      ipAddress: row.ip_address,
      previousValue: row.previous_value,
      newValue: row.new_value,
      metadata: row.metadata,
      createdAt: row.created_at,
    })),
    page,
    pageSize,
    total: count,
  };
}

/** Distinct action keys, for populating the filter without a full scan. */
export async function distinctActions(): Promise<string[]> {
  const rows = await AuditLog.findAll({
    attributes: [[fn('DISTINCT', col('action')), 'action']],
    raw: true,
  });

  return (rows as unknown as Array<{ action: string }>).map((row) => row.action).sort();
}
