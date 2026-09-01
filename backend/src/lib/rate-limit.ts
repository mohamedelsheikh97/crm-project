import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app-error.js';

/**
 * A fixed-window counter (research.md D11).
 *
 * Small on purpose. The behaviour this phase needs is "how many times has this
 * key been seen in the last minute?", and the project has precedent for writing
 * infrastructure of exactly this size itself — `scheduler.ts` is a
 * `setInterval` and `notification-hub.ts` is an `EventEmitter`.
 *
 * KNOWN LIMIT, inherited rather than introduced: this is process memory, so the
 * ceiling is per process. Phase 4 already recorded the single-process
 * assumption for the stream hub and the scheduler and deferred lifting it to
 * Phase 11. Under that assumption a per-process limiter is honest; with two
 * processes the effective ceiling doubles, which is a capacity question rather
 * than a correctness one. Lifting it means a shared store behind this module,
 * which is why every check goes through one function.
 *
 * This is the first defence in front of the first endpoints in this project
 * that anyone on the internet can reach (FR-078, FR-086, FR-099, FR-105), and
 * the bound on how many rows a stranger can add to `customers` (research D7).
 */

interface Window {
  count: number;
  /** Epoch ms at which the window resets. */
  resetAt: number;
}

const windows = new Map<string, Window>();

const WINDOW_MS = 60_000;

/**
 * Entries expire by being overwritten, but a key seen once and never again
 * would sit in the map forever. Sweeping on write keeps the map proportional to
 * live traffic rather than to all traffic ever seen.
 */
function sweep(now: number): void {
  if (windows.size < 1000) return;

  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateVerdict {
  allowed: boolean;
  /** Seconds until the window resets. Sent as Retry-After. */
  retryAfterSeconds: number;
}

/**
 * Counts one hit against `key` and says whether it is within `limit`.
 *
 * Usable directly inside the intake path, not only as middleware — an inbound
 * email is rate limited by sender, and no Express request is involved.
 */
export function hit(key: string, limit: number, windowMs: number = WINDOW_MS): RateVerdict {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  existing.count += 1;

  return {
    allowed: existing.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Read the current count without consuming one. Used by tests. */
export function peek(key: string): number {
  const window = windows.get(key);
  if (!window || window.resetAt <= Date.now()) return 0;
  return window.count;
}

/** Tests reset between cases; nothing in production calls this. */
export function reset(): void {
  windows.clear();
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', 429, 'Too many requests. Try again shortly.');
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The client's address, taken from the socket rather than from a header.
 *
 * `X-Forwarded-For` is trivially forged, and a limiter that trusts it can be
 * bypassed by anyone who sets one. Behind a proxy this needs Express's `trust
 * proxy` set deliberately, which is a deployment decision rather than a default
 * this file should make.
 */
function callerKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Middleware for the public endpoints. `scope` keeps channels independent, so
 * a flood of form submissions cannot exhaust the chat allowance (FR-100).
 */
export function rateLimit(scope: string, limit: number) {
  return rateLimitKeyed(scope, limit, callerKey);
}

/**
 * The same limiter, keyed by something other than the caller's address
 * (Phase 8, research D11).
 *
 * The portal needs this and the public surface did not. An anonymous visitor IS
 * their IP address, so keying on it is the only option; a signed-in customer has
 * an account id, and using it is materially better. AN OFFICE BEHIND ONE ADDRESS
 * IS MANY CUSTOMERS — key their portal reads on the IP and one person clicking
 * quickly denies service to all of their colleagues, which is a self-inflicted
 * outage rather than a defence.
 *
 * The unauthenticated portal endpoints — sign-in, credential recovery,
 * invitation acceptance — still key on the address, because at that point there
 * is no account to key on and the flood being defended against is exactly
 * somebody trying to find one.
 */
export function rateLimitKeyed(scope: string, limit: number, keyOf: (req: Request) => string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const verdict = hit(`${scope}:${keyOf(req)}`, limit);

    if (!verdict.allowed) {
      next(new RateLimitedError(verdict.retryAfterSeconds));
      return;
    }

    next();
  };
}
