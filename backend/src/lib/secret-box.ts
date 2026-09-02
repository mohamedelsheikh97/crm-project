import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from '../config/env.js';

/**
 * Reversible encryption for secrets THIS SYSTEM MUST USE (Phase 11).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS WHEN EVERYTHING ELSE IN THE PROJECT IS HASHED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every other secret in this codebase is stored as a one-way hash — passwords,
 * portal invitation tokens, API client secrets — because in every one of those
 * cases somebody ELSE holds the secret and we only ever need to VERIFY what they
 * present. A hash is exactly right, and the constitution's Security by Default
 * principle names hashing for that reason.
 *
 * A webhook signing secret is the other way round. WE sign; the subscriber
 * verifies. HMAC needs the key material, and a SHA-256 digest cannot produce a
 * signature — so a hashed signing secret is not a stricter version of the same
 * design, it is a design that cannot work.
 *
 * The first draft of this phase got that wrong: it stored the hash and kept the
 * plaintext in a process-lifetime `Map`, which meant signing silently stopped
 * working after a restart. That is recorded here rather than quietly fixed,
 * because the mistake is an easy one to repeat — the two cases look identical
 * until you ask who verifies.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AES-256-GCM WITH A KEY FROM THE ENVIRONMENT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Storing the secret in plaintext would work and is what many systems do. This
 * is one step better for a cost of about forty lines: a database dump alone
 * yields nothing, because the key lives in the environment alongside the JWT
 * secrets rather than in the database.
 *
 * GCM rather than CBC because it authenticates as well as encrypts — a tampered
 * ciphertext fails to open rather than decrypting to rubbish that then gets used
 * as a signing key. The IV is random per seal and stored with the ciphertext,
 * which is required: a reused IV under GCM is a catastrophic failure, not a
 * weakness.
 *
 * WHAT THIS IS NOT. It is not a key management system. There is one key, it does
 * not rotate, and re-keying means re-sealing every row. A deployment that needs
 * more than that needs a secret store, and that is out of scope for this phase.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function key(): Buffer {
  const raw = Buffer.from(env.WEBHOOK_SIGNING_KEY, 'base64');

  if (raw.length !== KEY_BYTES) {
    // Checked here as well as in the env schema: a wrong-length key would
    // otherwise fail inside `createCipheriv` with a message that says nothing
    // about which variable is wrong.
    throw new Error(`WEBHOOK_SIGNING_KEY must decode to ${KEY_BYTES} bytes; got ${raw.length}`);
  }

  return raw;
}

/** `<iv>.<tag>.<ciphertext>`, all base64. One string, one column. */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export class SealedValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedValueError';
  }
}

export function open(sealed: string): string {
  const parts = sealed.split('.');

  if (parts.length !== 3) {
    throw new SealedValueError('sealed value is malformed');
  }

  const [ivPart, tagPart, ciphertextPart] = parts as [string, string, string];

  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, 'base64'));

    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    /**
     * A failed open means the ciphertext was tampered with, or the key changed.
     *
     * Distinguished from a malformed value because the operator's action
     * differs: a malformed row is corrupt data, a failed tag with a valid shape
     * usually means somebody replaced `WEBHOOK_SIGNING_KEY`.
     */
    throw new SealedValueError(
      error instanceof Error && error.message.includes('auth')
        ? 'sealed value failed authentication — the key may have changed'
        : 'sealed value could not be opened',
    );
  }
}
