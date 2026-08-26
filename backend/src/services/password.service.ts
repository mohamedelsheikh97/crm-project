import bcrypt from 'bcrypt';
import { Op, type Transaction } from 'sequelize';

import { env } from '../config/env.js';
import type { ErrorDetail } from '../errors/app-error.js';
import { PasswordHistory } from '../models/index.js';

export const BCRYPT_COST = 12;

/**
 * Returns per-rule failures rather than a boolean: FR-022 requires naming the
 * specific rule that failed, so a caller needs to know which one did.
 *
 * `field` is the input the message attaches to, so the form can put each error
 * beside the right control.
 */
export function validatePolicy(password: unknown, field = 'newPassword'): ErrorDetail[] {
  const failures: ErrorDetail[] = [];

  if (typeof password !== 'string' || password.length === 0) {
    return [{ field, message: 'password.rule.required' }];
  }

  if (password.length < env.PASSWORD_MIN_LENGTH) {
    failures.push({ field, message: 'password.rule.minLength' });
  }

  if (!/[a-z]/.test(password)) {
    failures.push({ field, message: 'password.rule.lowercase' });
  }

  if (!/[A-Z]/.test(password)) {
    failures.push({ field, message: 'password.rule.uppercase' });
  }

  if (!/[0-9]/.test(password)) {
    failures.push({ field, message: 'password.rule.digit' });
  }

  return failures;
}

export async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verify(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/**
 * Reuse can only be checked by comparing against stored hashes — there is no
 * way that does not involve keeping something (research.md D9).
 */
export async function isReused(userId: number, password: string): Promise<boolean> {
  const previous = await PasswordHistory.scope('withHash').findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
    limit: env.PASSWORD_HISTORY_SIZE,
  });

  for (const entry of previous) {
    if (await bcrypt.compare(password, entry.password_hash)) {
      return true;
    }
  }

  return false;
}

/**
 * Records a hash and prunes beyond the window, so the table stays bounded and
 * an old hash does not outlive its purpose.
 */
export async function recordHistory(
  userId: number,
  passwordHash: string,
  transaction: Transaction,
): Promise<void> {
  await PasswordHistory.create({ user_id: userId, password_hash: passwordHash }, { transaction });

  const keep = await PasswordHistory.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
    limit: env.PASSWORD_HISTORY_SIZE,
    attributes: ['id'],
    transaction,
  });

  const keepIds = keep.map((entry) => entry.id);

  await PasswordHistory.destroy({
    where: { user_id: userId, id: { [Op.notIn]: keepIds } },
    transaction,
  });
}
