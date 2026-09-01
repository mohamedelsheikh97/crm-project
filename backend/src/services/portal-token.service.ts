import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { unauthenticated } from '../errors/app-error.js';

/**
 * THE SECOND IDENTITY REALM (Phase 8, FR-012, research.md D1).
 *
 * A deliberate copy of `token.service.ts`, not an extension of it, and the
 * duplication is the security property.
 *
 * Phase 1's file explains the pattern in its own words: "Distinct secrets make
 * cross-use cryptographically impossible; the `type` assertion makes the
 * rejection explicit and testable. Both are deliberate — neither is redundant
 * with the other." Phase 1 used it to stop a refresh token being presented as
 * an access token. This file applies the same pattern to a second axis, and that
 * axis matters more: the STAFF verifier's caller passes the token's subject to
 * `User.findByPk`, so a customer token of the same shape, signed with the same
 * key, would come back as a real staff account with a real role.
 *
 * With separate secrets, a staff token handed to `verifyPortalAccessToken` fails
 * SIGNATURE VERIFICATION — before any claim is read, in library code, with no
 * conditional for anyone to forget. `env.ts` refuses to start if any two of the
 * four secrets match.
 *
 * DO NOT "de-duplicate" this against `token.service.ts` by parameterising the
 * secret. A shared function with a realm argument is one wrong argument away
 * from the failure both files exist to make impossible, and it would put that
 * argument at every call site instead of in one import.
 *
 * THE SUBJECT IS A `portal_accounts.id`. Not a `customers.id`, not a
 * `customer_contacts.id`, and emphatically not a `users.id`.
 */

/**
 * SHORTER THAN THE STAFF SESSION (15 minutes there, 10 here) and the difference
 * is not arbitrary. An access token is the one window in which a withdrawal is
 * not yet enforced by the middleware's freshness read, and a portal credential
 * lives on a customer's own device — a shared laptop, a phone in a drawer —
 * rather than on a managed machine inside the building.
 */
export const PORTAL_ACCESS_TOKEN_TTL_SECONDS = 600; // 10 minutes
export const PORTAL_REFRESH_TOKEN_TTL_SECONDS = 604_800; // 7 days

const ACCESS_TYPE = 'portal-access';
const REFRESH_TYPE = 'portal-refresh';

export interface PortalAccessTokenPayload {
  /** `portal_accounts.id`. */
  id: number;
}

export interface PortalRefreshTokenPayload {
  id: number;
  /**
   * The account's `session_epoch` at issue time.
   *
   * This is what makes withdrawal work on a token that lives for a week. The
   * access token is caught within ten minutes by the middleware reading the
   * account fresh; a refresh token is only ever seen by the refresh endpoint, so
   * it has to carry enough for that endpoint to refuse it. Withdrawal,
   * credential reset, and "sign out everywhere" all increment the account's
   * epoch, and a token carrying an older one is dead (FR-060, SC-031).
   */
  epoch: number;
}

export function signPortalAccessToken({ id }: PortalAccessTokenPayload): string {
  // NO EMAIL CLAIM, unlike the staff access token. The middleware loads the
  // contact anyway, and a customer's address in a token is a customer's address
  // in every log that ever prints one.
  return jwt.sign({ type: ACCESS_TYPE }, env.PORTAL_JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: String(id),
    expiresIn: PORTAL_ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function signPortalRefreshToken({ id, epoch }: PortalRefreshTokenPayload): string {
  return jwt.sign({ type: REFRESH_TYPE, epoch }, env.PORTAL_JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    subject: String(id),
    expiresIn: PORTAL_REFRESH_TOKEN_TTL_SECONDS,
  });
}

function subjectId(payload: jwt.JwtPayload): number {
  if (typeof payload.sub !== 'string') throw unauthenticated();

  const id = Number(payload.sub);

  if (!Number.isInteger(id) || id <= 0) throw unauthenticated();

  return id;
}

export function verifyPortalAccessToken(token: string): PortalAccessTokenPayload {
  let payload: jwt.JwtPayload;

  try {
    payload = jwt.verify(token, env.PORTAL_JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
  } catch {
    // A staff token lands here, as does an expired one, a tampered one, and a
    // portal REFRESH token. All four are the same answer.
    throw unauthenticated();
  }

  if (payload.type !== ACCESS_TYPE) throw unauthenticated();

  return { id: subjectId(payload) };
}

export function verifyPortalRefreshToken(token: string): PortalRefreshTokenPayload {
  let payload: jwt.JwtPayload;

  try {
    payload = jwt.verify(token, env.PORTAL_JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
  } catch {
    throw unauthenticated();
  }

  if (payload.type !== REFRESH_TYPE || typeof payload.epoch !== 'number') {
    throw unauthenticated();
  }

  return { id: subjectId(payload), epoch: payload.epoch };
}
