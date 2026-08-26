import bcrypt from 'bcrypt';

import {
  invalidCredentials,
  unauthenticated,
  validationError,
  type ErrorDetail,
} from '../errors/app-error.js';
import { User } from '../models/index.js';

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

export async function login(email: unknown, password: unknown): Promise<LoginResult> {
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
    throw invalidCredentials();
  }

  const matches = await bcrypt.compare(String(password), user.password_hash);

  if (!matches) {
    // Identical error to the branch above — any difference is an account
    // enumeration defect, not a cosmetic one.
    throw invalidCredentials();
  }

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
