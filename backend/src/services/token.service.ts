import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { unauthenticated } from '../errors/app-error.js';

export const ACCESS_TOKEN_TTL_SECONDS = 900; // 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 604_800; // 7 days

export interface AccessTokenPayload {
  id: number;
  email: string;
}

export function signAccessToken({ id, email }: AccessTokenPayload): string {
  return jwt.sign({ email, type: 'access' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: String(id),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function signRefreshToken({ id }: { id: number }): string {
  // No email claim: the refresh token carries no identity beyond the subject.
  return jwt.sign({ type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    subject: String(id),
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
}

/**
 * Distinct secrets make cross-use cryptographically impossible; the `type`
 * assertion makes the rejection explicit and testable. Both are deliberate
 * (research.md D5) — neither is redundant with the other.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  let payload: jwt.JwtPayload;

  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    throw unauthenticated();
  }

  if (payload.type !== 'access' || typeof payload.sub !== 'string') {
    throw unauthenticated();
  }

  const id = Number(payload.sub);

  if (!Number.isInteger(id) || typeof payload.email !== 'string') {
    throw unauthenticated();
  }

  return { id, email: payload.email };
}

export function verifyRefreshToken(token: string): { id: number } {
  let payload: jwt.JwtPayload;

  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
  } catch {
    throw unauthenticated();
  }

  if (payload.type !== 'refresh' || typeof payload.sub !== 'string') {
    throw unauthenticated();
  }

  const id = Number(payload.sub);

  if (!Number.isInteger(id)) {
    throw unauthenticated();
  }

  return { id };
}
