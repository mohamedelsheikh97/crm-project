import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as searchService from '../../src/services/kb-search.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle, searchIds } from './helpers.js';

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
 * Ranking (FR-019, research D3, SC-008).
 *
 * Two halves, and people remember the first and forget the second:
 *
 *   FIELD WEIGHT stops an article that mentions a word once in passing
 *   outranking the article NAMED after that word.
 *
 *   THE FRACTION-MATCHED MULTIPLIER stops a long article containing one of the
 *   reader's five words outranking a short one containing all five. Without it,
 *   length wins, and the most verbose article in the corpus becomes the answer
 *   to everything.
 *
 * And underneath both, a TOTAL ordering. "Whatever the database returned" is
 * not an ordering: two agents opening the same ticket would see different
 * suggestions, disagree about what the system said, and have no way to tell
 * which of them was looking at a bug.
 */

describe('a title match outranks a body match', () => {
  it('puts the article named after the term first', async () => {
    const buried = await makeArticle({
      titleEn: 'General terminal maintenance',
      bodyEn:
        'Check the power supply, the network cable, and the card reader. Then check the printer, ' +
        'the display, and the keypad. Then restart the terminal.',
    });

    const named = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
    });

    expect(await searchIds('card reader')).toEqual([named.id, buried.id]);
  });
});

describe('matching MORE of the query outranks matching more of one word', () => {
  it('prefers the short article answering the whole question to the long one mentioning a word', async () => {
    // The case research D3 names: a LONG article containing one of the reader's
    // words, against a SHORT one containing all of them. Without the
    // fraction-matched multiplier, length wins and the most verbose article in
    // the corpus becomes the answer to everything.
    const partial = await makeArticle({
      titleEn: 'Terminal maintenance notes',
      bodyEn: 'printer printer printer printer printer printer printer printer',
    });

    const whole = await makeArticle({
      titleEn: 'Fault checklist',
      bodyEn: 'The printer jams when the reader reboots.',
    });

    const ids = await searchIds('printer reader reboots');

    expect(ids[0]).toBe(whole.id);
    expect(ids).toContain(partial.id);
  });

  it('lets a TITLE match win over a fuller body match, and that is the intended trade', async () => {
    // Stated as an assertion because it is the one place the two halves of the
    // ranking pull against each other, and the resolution is deliberate rather
    // than accidental.
    //
    // An article TITLED "Printer notes" is a claim that the whole document is
    // about printers. A body that happens to contain all three query words is a
    // weaker signal than that — which is why the field weight is 10 and the
    // fraction multiplier is linear rather than exponential.
    //
    // If a corpus review (T097) finds this trade wrong, the fix is the weight
    // in FIELD_WEIGHTS, not a special case here.
    const titled = await makeArticle({
      titleEn: 'Printer notes',
      bodyEn: 'printer printer printer',
    });

    const fuller = await makeArticle({
      titleEn: 'Checklist',
      bodyEn: 'The printer jams when the reader reboots.',
    });

    const ids = await searchIds('printer reader reboots');

    expect(ids[0]).toBe(titled.id);
    expect(ids).toContain(fuller.id);
  });
});

describe('the ordering is total and stable (SC-008)', () => {
  it('returns the same order twice for the same query', async () => {
    for (let i = 0; i < 5; i += 1) {
      await makeArticle({ titleEn: `Card reader note ${i}`, bodyEn: 'Replace the cable.' });
    }

    const first = await searchIds('card reader');
    const second = await searchIds('card reader');

    expect(second).toEqual(first);
  });

  it('breaks a score tie by most-recently-updated, then by id', async () => {
    // Identical text, so the scores are identical. Something must decide, and
    // it must decide the same way for every caller.
    const older = await makeArticle({
      titleEn: 'Card reader',
      bodyEn: 'Replace the cable.',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const newer = await makeArticle({
      titleEn: 'Card reader',
      bodyEn: 'Replace the cable.',
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    });

    expect(await searchIds('card reader')).toEqual([newer.id, older.id]);
  });

  it('gives two different callers the same order', async () => {
    // SC-008 stated literally: two agents open the same ticket and must not
    // disagree about what the system suggested.
    for (let i = 0; i < 4; i += 1) {
      await makeArticle({ titleEn: `Reader note ${i}`, bodyEn: 'The card reader reboots.' });
    }

    const [a, b] = await Promise.all([
      searchService.search({ query: 'card reader', lang: 'en', audience: 'internal' }),
      searchService.search({ query: 'card reader', lang: 'en', audience: 'internal' }),
    ]);

    expect(a.items.map((h) => h.articleId)).toEqual(b.items.map((h) => h.articleId));
  });
});

describe('a repeated word cannot dominate', () => {
  it('caps the contribution of one term within one field', async () => {
    // A word repeated fifty times must not beat an article that is genuinely
    // about the subject. Three occurrences already say "this is about this".
    const spammy = await makeArticle({
      titleEn: 'Notes',
      bodyEn: Array(50).fill('reader').join(' '),
    });

    const real = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'The reader power-cycles when the card is inserted.',
    });

    expect((await searchIds('card reader'))[0]).toBe(real.id);
    expect(await searchIds('reader')).toContain(spammy.id);
  });
});

describe('results carry what a reader needs to choose', () => {
  it('returns the matched excerpt, the language, and the category (FR-021, FR-005a)', async () => {
    await makeArticle({
      titleEn: 'Terminal maintenance',
      bodyEn:
        'Begin with the power supply and the network cable. The card reader power-cycles when a ' +
        'damaged card is inserted, which is the most common cause of this fault.',
    });

    const result = await searchService.search({
      query: 'power-cycles',
      lang: 'en',
      audience: 'internal',
    });

    const hit = result.items[0]!;

    // The excerpt is what lets a reader choose between five results without
    // opening five of them.
    expect(hit.excerpt).toContain('power-cycles');
    expect(hit.lang).toBe('en');
    expect(hit.categoryName).not.toBeNull();
    expect(hit.slug).not.toBeNull();
  });
});
