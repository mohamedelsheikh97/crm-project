import { env } from '../config/env.js';
import { AddressNotPermittedError, assertPubliclyRoutable } from '../lib/net-address.js';

import { sign } from './signing.js';

/**
 * ONE DELIVERY ATTEMPT (Phase 11, US2, FR-029, FR-035, FR-036, research D8).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PERMANENT AND TRANSIENT FAILURES ARE DIFFERENT, AND CONFLATING THEM IS COSTLY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Retrying a `404` six times over twenty-one hours tells an administrator
 * nothing they did not know after the first attempt, and fills the failure list
 * with noise that hides the real problems. Retrying a `503` is exactly right.
 * So the classification is explicit rather than "anything that is not 2xx".
 *
 * `408` and `429` are the two `4xx` codes that ARE transient: one says the
 * receiver ran out of time, the other says come back later. Treating them as
 * permanent would abandon a receiver that explicitly asked to be retried.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ADDRESS IS RE-CHECKED HERE, NOT ONLY AT SAVE TIME (FR-034).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A hostname that resolved publicly when the subscription was saved can be
 * repointed at `127.0.0.1` afterwards. That is DNS rebinding, and a
 * save-time-only check does not see it. The classifier is the same one Phase 9
 * uses for the opposite requirement — see `lib/net-address.ts`, which explains
 * why the two directions share a classifier but not an assertion.
 *
 * REDIRECTS ARE NOT FOLLOWED (FR-035), for the same reason: a public endpoint
 * answering `302 http://169.254.169.254/` would otherwise walk the guard
 * straight past itself.
 */

export type DeliveryOutcome =
  | { readonly kind: 'succeeded'; readonly status: number }
  | { readonly kind: 'transient'; readonly status: number | null; readonly reason: string }
  | { readonly kind: 'permanent'; readonly status: number | null; readonly reason: string };

export interface DeliveryRequest {
  readonly url: string;
  readonly eventType: string;
  readonly eventKey: string;
  readonly payload: unknown;
  /** Current secret first; a second is present during a rotation overlap. */
  readonly secrets: readonly string[];
}

/**
 * Classifies a response status.
 *
 * Exported so the retry test can assert the table directly rather than by
 * standing up a receiver for each code — the classification is the decision, and
 * testing it through HTTP would test `fetch` as much as this.
 */
export function classify(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) return { kind: 'succeeded', status };

  if (status >= 300 && status < 400) {
    return {
      kind: 'permanent',
      status,
      // Named plainly, because an administrator seeing this needs to know it is
      // their receiver's configuration rather than our network.
      reason: 'the receiver returned a redirect, which is not followed',
    };
  }

  if (status === 408 || status === 429) {
    return { kind: 'transient', status, reason: `receiver answered ${status}` };
  }

  if (status >= 400 && status < 500) {
    return {
      kind: 'permanent',
      status,
      reason: `receiver answered ${status}; retrying will not change that`,
    };
  }

  return { kind: 'transient', status, reason: `receiver answered ${status}` };
}

/**
 * Delivers one payload. Never throws — the outcome is the return value.
 *
 * A throw here would have to be caught by the sweep and turned into an outcome
 * anyway, and the shape that matters is "what do we record and do we retry?".
 * Returning it keeps that decision in one place.
 */
export async function deliver(request: DeliveryRequest): Promise<DeliveryOutcome> {
  try {
    /**
     * Re-checked at delivery: see the header note on DNS rebinding.
     *
     * `WEBHOOK_ALLOW_LOOPBACK` is the one door, and `config/env.ts` REFUSES TO
     * START if it is set outside `NODE_ENV=test`. It exists so delivery can be
     * tested against a real local server rather than a mocked `fetch` — which
     * would let the suite pass while the signature was computed over the wrong
     * bytes, or the timeout never applied.
     */
    if (!env.WEBHOOK_ALLOW_LOOPBACK) {
      assertPubliclyRoutable(request.url, 'url');
    }
  } catch (error) {
    return {
      kind: 'permanent',
      status: null,
      reason:
        error instanceof AddressNotPermittedError
          ? `address refused: ${error.reason}`
          : 'address refused',
    };
  }

  const { body, signature } = sign(request.payload, request.secrets);

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      // The EXACT bytes that were signed. Not `JSON.stringify(payload)` again —
      // that is the standard way a signature stops matching.
      body,
      headers: {
        'Content-Type': 'application/json',
        'X-CRM-Event': request.eventType,
        'X-CRM-Event-Id': request.eventKey,
        'X-CRM-Signature': signature,
        'User-Agent': 'CRM-Support-Webhooks/1',
      },
      /**
       * NOT FOLLOWED (FR-035). `manual` makes a 3xx a response we classify
       * rather than a hop `fetch` takes on our behalf.
       */
      redirect: 'manual',
      /**
       * A receiver that accepts a connection and never answers would otherwise
       * hold a socket for as long as the OS allows, and enough of them would
       * exhaust the pool. This is not optional in spirit.
       */
      signal: AbortSignal.timeout(env.WEBHOOK_TIMEOUT_MS),
    });

    return classify(response.status);
  } catch (error) {
    /**
     * Network-level failures, all transient.
     *
     * A timeout, a refused connection and a TLS failure are all things that may
     * be different in five minutes — and the REASON is recorded verbatim because
     * "TLS certificate expired" is actionable while "delivery failed" is not
     * (FR-060).
     */
    const reason =
      error instanceof Error
        ? error.name === 'TimeoutError' || error.name === 'AbortError'
          ? `no response within ${env.WEBHOOK_TIMEOUT_MS}ms`
          : error.message
        : 'delivery failed';

    return { kind: 'transient', status: null, reason: reason.slice(0, 255) };
  }
}
