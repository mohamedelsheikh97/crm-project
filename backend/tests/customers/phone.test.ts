import { describe, expect, it } from 'vitest';

import { isSameContact, normaliseEmail, normalisePhone } from '../../src/lib/phone.js';

/**
 * quickstart B2 / FR-005 / SC-002.
 *
 * This is where PLAN.md's Definition of done — "duplicates flagged rather than
 * silently created" — either works or does not. Everything else in duplicate
 * detection is straightforward; formatting is the part that quietly fails.
 *
 * The dangerous failure here is a MISSED match, not a false one: nothing
 * surfaces at the time, and by Phase 3 one person's support history is split
 * across two records with no clean way to reunite it.
 */
describe('phone normalisation', () => {
  const EGYPTIAN_SAME = [
    '+20 100 123 4567',
    '01001234567',
    '0100-123-4567',
    '+201001234567',
    '0100 123 4567',
    '(0100) 123 4567',
  ];

  it('treats every formatting of the same Egyptian number as identical', () => {
    const normalised = EGYPTIAN_SAME.map(normalisePhone);
    const distinct = new Set(normalised);

    // The exact canonical form matters less than every variant agreeing on it.
    expect([...distinct]).toHaveLength(1);
    expect(normalised[0]).toBe('+201001234567');
  });

  it.each(EGYPTIAN_SAME.flatMap((a, i) => EGYPTIAN_SAME.slice(i + 1).map((b) => [a, b] as const)))(
    'matches %s against %s',
    (a, b) => {
      expect(isSameContact('phone', a, b)).toBe(true);
    },
  );

  it('does not collide two different numbers that share a digit tail', () => {
    // The failure mode of the naive "strip non-digits, compare the last N"
    // rule: a UK and an Egyptian number ending in the same digits.
    const egyptian = normalisePhone('+20 100 123 4567');
    const british = normalisePhone('+44 7100 123456');

    expect(egyptian).not.toBe(british);
    expect(isSameContact('phone', '+20 100 123 4567', '+44 7100 123456')).toBe(false);
  });

  it('does not treat two different local numbers as the same', () => {
    expect(isSameContact('phone', '01001234567', '01001234568')).toBe(false);
  });

  it('keeps an unparseable number stable and searchable rather than discarding it', () => {
    // A support system must be able to record what a customer actually gave.
    const messy = 'ext. 4421';

    expect(normalisePhone(messy)).toBe('4421');
    // Stable: the same input always produces the same value, so it is findable.
    expect(normalisePhone(messy)).toBe(normalisePhone('ext.4421'));
  });

  it('distinguishes an unplaceable international number from a local one', () => {
    // The leading + is preserved when the parser cannot place the number, or a
    // foreign number would collapse onto a local one.
    expect(normalisePhone('+999 12 345')).toBe('+99912345');
    expect(normalisePhone('99912345')).toBe('99912345');
    expect(isSameContact('phone', '+999 12 345', '99912345')).toBe(false);
  });

  it('returns an empty string for empty input rather than throwing', () => {
    expect(normalisePhone('')).toBe('');
    expect(normalisePhone('   ')).toBe('');
    // An empty value must never match another empty value as a "duplicate".
    expect(isSameContact('phone', '', '')).toBe(false);
  });

  it('is idempotent — normalising a normalised value changes nothing', () => {
    const once = normalisePhone('+20 100 123 4567');

    expect(normalisePhone(once)).toBe(once);
  });
});

describe('email normalisation', () => {
  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(normaliseEmail('  Ahmed@Example.COM ')).toBe('ahmed@example.com');
    expect(isSameContact('email', 'Ahmed@Example.com', 'ahmed@example.com')).toBe(true);
  });

  it('does not treat different addresses as the same', () => {
    expect(isSameContact('email', 'a@example.com', 'b@example.com')).toBe(false);
  });

  it('never matches an empty value', () => {
    expect(isSameContact('email', '', '')).toBe(false);
  });
});
