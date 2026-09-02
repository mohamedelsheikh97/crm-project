import type { Request } from 'express';

import { env } from '../config/env.js';

/**
 * The four AI rate-limit scopes (Phase 9, research.md D11).
 *
 * Declared once here and applied by the routers, so the set is enumerable and
 * FR-005a's independence property can be asserted rather than assumed.
 *
 * SEPARATE FROM THE DAILY CEILINGS in `budget.ts`, and the distinction matters.
 * A rate limit stops one principal hammering one surface within a minute; a
 * ceiling stops the organisation's bill running away across all principals over
 * a day. Either can be hit without the other.
 *
 * THE CUSTOMER-FACING SCOPE IS INDEPENDENT of the staff ones (FR-005a, FR-040).
 * That is the property Phase 5 built per-scope keying for and Phases 7 and 8
 * reused unchanged: a customer exhausting the assistant allowance must not stop
 * an agent summarising a ticket.
 */
export const AI_SCOPES = {
  SUMMARY: 'ai-summary',
  DRAFT: 'ai-draft',
  CLASSIFY: 'ai-classify',
  ASSISTANT: 'ai-assistant',
} as const;

/**
 * Staff features are per-minute-per-user and generous: an agent working a queue
 * legitimately opens many tickets, and the daily ceiling is what bounds cost.
 * The limiter here exists to stop a runaway client, not to ration ordinary work.
 */
export const AI_STAFF_PER_MINUTE = 20;

/**
 * The assistant reuses the portal's allowance, because a customer holding a
 * conversation is doing the same kind of thing at the same rate as a customer
 * reading their requests.
 */
export const AI_ASSISTANT_PER_MINUTE = env.PORTAL_RATE_PER_MINUTE;

/**
 * Keys staff AI calls by USER, not by address.
 *
 * Phase 8's D11 recorded why address-keying is wrong for anyone who has an
 * identity: an office behind one address is many people, and keying on the IP
 * means one person clicking quickly denies service to their colleagues. That
 * applies to a support team in one building exactly as it applies to a
 * customer's staff.
 */
export function byUser(req: Request): string {
  return req.user ? `user:${req.user.id}` : `anon:${req.ip ?? 'unknown'}`;
}

/**
 * Keys the assistant by PORTAL ACCOUNT where there is one, and by address only
 * for the anonymous chat visitor — who genuinely has no better key, which is
 * Phase 8's own reasoning for its unauthenticated endpoints.
 */
export function byPortalAccount(req: Request): string {
  return req.portal ? `portal:${req.portal.accountId}` : `anon:${req.ip ?? 'unknown'}`;
}
