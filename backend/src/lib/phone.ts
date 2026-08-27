import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

import { env } from '../config/env.js';

/**
 * THE SINGLE NORMALISATION SITE.
 *
 * Contact writes, search, and duplicate detection all call these functions.
 * Three callers each normalising slightly differently is exactly how SC-002
 * rots — and its failure mode is a MISSED duplicate, which surfaces nothing at
 * the time and splits a customer's history across two records by Phase 3.
 *
 * These are pure functions with no model access and no business rules, which is
 * why they live in `lib/` rather than `services/`. Services own decisions;
 * this owns a transformation.
 *
 * Normalisation is for MATCHING ONLY. What the user typed is stored alongside
 * in `value_raw` and is always what a human is shown — rewriting someone's
 * input into E.164 on screen looks like a bug (contracts/customer-ui.md).
 */

export type ContactKind = 'phone' | 'email';

/**
 * E.164 where the number parses against the configured region, digits-only
 * otherwise.
 *
 * The fallback matters: a support system must be able to record a number
 * exactly as a customer gave it, including one that is malformed or carries an
 * extension. An unparseable number is still stored and still searchable — it
 * simply matches less cleverly.
 */
export function normalisePhone(raw: string): string {
  const trimmed = String(raw).trim();

  if (trimmed === '') {
    return '';
  }

  const parsed = parsePhoneNumberFromString(trimmed, env.DEFAULT_PHONE_REGION as CountryCode);

  if (parsed?.isValid()) {
    return parsed.number;
  }

  // Keep the leading + when one was given: it distinguishes an international
  // number the parser could not place from a local one.
  const digits = trimmed.replace(/[^\d]/g, '');

  return trimmed.startsWith('+') && digits !== '' ? `+${digits}` : digits;
}

/**
 * Lowercased and trimmed. The database collation is already case-insensitive,
 * but normalising on write means the stored value is canonical rather than
 * relying on every future query remembering.
 */
export function normaliseEmail(raw: string): string {
  return String(raw).trim().toLowerCase();
}

export function normaliseContact(kind: ContactKind, raw: string): string {
  return kind === 'phone' ? normalisePhone(raw) : normaliseEmail(raw);
}

/**
 * True when two values refer to the same contact.
 *
 * Callers should compare normalised values directly in SQL; this exists for
 * in-process checks and for making the intent explicit in tests.
 */
export function isSameContact(kind: ContactKind, a: string, b: string): boolean {
  const left = normaliseContact(kind, a);
  const right = normaliseContact(kind, b);

  return left !== '' && left === right;
}
