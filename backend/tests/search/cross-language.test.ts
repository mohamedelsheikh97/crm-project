import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as searchService from '../../src/services/kb-search.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * The cross-language near-miss (FR-029, FR-005a).
 *
 * WHAT THIS IS FOR: an agent searches in Arabic, finds nothing, and gives up —
 * while the answer sits in the corpus in English. Reporting a flat absence in
 * that situation is a lie by omission.
 *
 * WHAT IT MUST NOT DO: hand them the English articles anyway. Being given
 * content in a language you did not ask for, unlabelled, is precisely what
 * FR-005a exists to prevent — the reader sees a page they cannot read and
 * concludes the system is broken rather than that the article is in English.
 *
 * So the answer carries a COUNT and the reader decides. Offering to look is not
 * the same as looking on somebody's behalf.
 */

const ENGLISH = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'The reader power-cycles when the card is inserted.',
};

const ARABIC = {
  titleAr: 'قارئ البطاقة يعيد التشغيل',
  bodyAr: 'يعيد القارئ التشغيل عند إدخال البطاقة.',
};

describe('when the search language finds nothing', () => {
  it('reports how many the OTHER language has, without returning them', async () => {
    await makeArticle(ENGLISH);
    await makeArticle(ENGLISH);
    await makeArticle(ENGLISH);

    const result = await searchService.search({
      query: 'card reader',
      lang: 'ar',
      audience: 'internal',
    });

    // Nothing in Arabic...
    expect(result.items).toEqual([]);
    // ...but an OFFER, with a count.
    expect(result.otherLanguage).toEqual({ lang: 'en', count: 3 });
  });

  it('offers in the other direction too', async () => {
    await makeArticle(ARABIC);

    const result = await searchService.search({
      query: 'قارئ',
      lang: 'en',
      audience: 'internal',
    });

    expect(result.items).toEqual([]);
    expect(result.otherLanguage).toEqual({ lang: 'ar', count: 1 });
  });
});

describe('the offer is not made when it would be noise', () => {
  it('is absent when the search language DID find something', async () => {
    // An offer beside results the reader can already read is clutter, and
    // implies their results were somehow inadequate.
    await makeArticle(ENGLISH);
    await makeArticle(ARABIC);

    const result = await searchService.search({
      query: 'card reader',
      lang: 'en',
      audience: 'internal',
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.otherLanguage).toBeNull();
  });

  it('is absent when NEITHER language has anything', async () => {
    // A flat absence is the honest answer here, and "0 articles match in
    // English" would be a worse way of saying nothing.
    await makeArticle(ENGLISH);

    const result = await searchService.search({
      query: 'aardvark',
      lang: 'ar',
      audience: 'internal',
    });

    expect(result.items).toEqual([]);
    expect(result.otherLanguage).toBeNull();
  });
});

describe('the offer respects visibility', () => {
  it('does not count internal articles for a customer-facing search', async () => {
    // Otherwise a public reader learns, from a number, that internal content
    // about their query exists — which is the disclosure FR-032c forbids by
    // another route.
    await makeArticle({ ...ENGLISH, audience: 'internal' });

    const result = await searchService.search({
      query: 'card reader',
      lang: 'ar',
      audience: 'customer',
    });

    expect(result.items).toEqual([]);
    expect(result.otherLanguage).toBeNull();
  });
});
