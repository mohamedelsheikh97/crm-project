import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Payload signing (Phase 11, US2, FR-027, FR-038, SC-014, research D9).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TIMESTAMP IS INSIDE THE SIGNED MATERIAL. THAT IS WHAT MAKES REPLAY HARD.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Signing the body alone lets a captured payload be replayed forever. Including
 * the timestamp in what is signed means a receiver can reject anything outside a
 * tolerance window AND a tampered timestamp invalidates the signature — the two
 * together are what close it. Signing the body and sending the timestamp
 * alongside would close neither.
 *
 * THE SCHEME IS DELIBERATELY THE FAMILIAR ONE. `t=<unix>,v1=<hex>` over
 * `<t>.<body>` is what Stripe and GitHub use, and an integrator who has verified
 * one of those will recognise it. FR-027's requirement is that verification is
 * POSSIBLE, and familiarity does more for that than elegance.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SIGN THE EXACT BYTES THAT ARE SENT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The standard way this breaks is serialising twice — once to sign, once to send
 * — because key order and number formatting are not guaranteed to match. So this
 * module takes and returns a STRING, and `delivery.ts` sends that same string.
 * Phase 5's inbound webhook verification records the mirror-image lesson in
 * `express.d.ts`: use the raw body, never a re-serialised `req.body`.
 */

/** The tolerance a receiver should apply, published in the contract. */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

const SECRET_BYTES = 32;

/**
 * A new signing secret.
 *
 * 32 random bytes, shown once and stored as SHA-256 — the same treatment a
 * credential secret gets, and for the same reason (`api-client.service.ts`
 * argues the SHA-256-not-bcrypt choice, which turns on the secret's entropy).
 */
export function newSigningSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

export interface SignedPayload {
  /** The exact string to send as the body. Sign and send the same bytes. */
  readonly body: string;
  /** The `X-CRM-Signature` header value. */
  readonly signature: string;
  readonly timestamp: number;
}

/**
 * Signs a payload with one or more secrets.
 *
 * MORE THAN ONE IS THE ROTATION CASE (FR-038). During an overlap both the old
 * and the new secret are used, and the header carries two `v1=` values, so a
 * receiver can accept either while it redeploys. A sequence of one-secret
 * windows would drop notifications in between — which is the outage rotation is
 * supposed to avoid.
 */
export function sign(payload: unknown, secrets: readonly string[]): SignedPayload {
  if (secrets.length === 0) {
    throw new Error('signing requires at least one secret');
  }

  // Serialised ONCE. This exact string is signed and sent.
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${body}`;

  const values = secrets.map(
    (secret) => `v1=${createHmac('sha256', secret).update(signed).digest('hex')}`,
  );

  return {
    body,
    signature: `t=${timestamp},${values.join(',')}`,
    timestamp,
  };
}

/**
 * Verifies a signature. Exported for the TESTS to use as a receiver would.
 *
 * Written here rather than in the test file so the suite verifies the way an
 * integrator will, from the same understanding of the format. A test that
 * reimplemented verification could agree with a broken signer.
 */
export function verify(options: {
  readonly header: string;
  readonly body: string;
  readonly secret: string;
  readonly now?: number;
  readonly toleranceSeconds?: number;
}): { valid: boolean; reason?: 'malformed' | 'stale' | 'mismatch' } {
  const parts = options.header.split(',').map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith('t='));
  const provided = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));

  if (!timestampPart || provided.length === 0) return { valid: false, reason: 'malformed' };

  const timestamp = Number(timestampPart.slice(2));

  if (!Number.isFinite(timestamp)) return { valid: false, reason: 'malformed' };

  const expected = createHmac('sha256', options.secret)
    .update(`${timestamp}.${options.body}`)
    .digest('hex');

  /**
   * Constant-time, and length-checked first.
   *
   * `timingSafeEqual` throws on a length mismatch, which would itself be a
   * signal — so lengths are compared before the buffers are.
   */
  const matched = provided.some((candidate) => {
    if (candidate.length !== expected.length) return false;

    return timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'));
  });

  if (!matched) return { valid: false, reason: 'mismatch' };

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? TIMESTAMP_TOLERANCE_SECONDS;

  // Checked AFTER the signature, so a wrong secret and a stale timestamp are
  // distinguishable in a test without the staleness check becoming a way to
  // probe signatures.
  if (Math.abs(now - timestamp) > tolerance) return { valid: false, reason: 'stale' };

  return { valid: true };
}
