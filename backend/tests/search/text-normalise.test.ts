import { describe, expect, it } from 'vitest';

import { normaliseForIndex, normaliseQuery } from '../../src/lib/text-normalise.js';

/**
 * THE ARABIC TABLE.
 *
 * This is the most important file in Phase 7, and the reason is not that it
 * covers the most code. It is that the behaviour it asserts is **invisible in a
 * diff**. Whether one Arabic spelling finds another cannot be checked by
 * reading the implementation unless you read Arabic, and the platform this
 * project runs on gets it demonstrably wrong — research D1 measured MySQL's own
 * full-text index returning zero matches for the first three cases below.
 *
 * So this file is not a check on the work. It is the only place the phase's
 * central claim is observable. A regression here reintroduces exactly the
 * failure the whole of research D1 exists to avoid, and nothing else in the
 * suite would notice.
 *
 * Every case below is one MySQL was measured getting wrong, or one that proves
 * the fix did not break something ordinary on the way past.
 */

/** Convenience: the terms `normaliseForIndex` produces, order-independent. */
function indexTerms(text: string): string[] {
  return normaliseForIndex(text)
    .map((token) => token.term)
    .sort();
}

describe('normalisation — the cases MySQL full-text gets wrong (research D1)', () => {
  it('a word and the same word with the definite article produce ONE token', () => {
    // MySQL: 0 matches, in both directions, with NO configuration fix
    // available. This single assertion is why the project owns its search.
    expect(normaliseQuery('كتاب')).toEqual(['كتاب']);
    expect(normaliseQuery('الكتاب')).toEqual(['كتاب']);
    expect(indexTerms('الكتاب')).toEqual(indexTerms('كتاب'));
  });

  it('a genuine two-letter Arabic word survives', () => {
    // MySQL: dropped entirely, because innodb_ft_min_token_size defaults to 3.
    // Changing it needs a global variable, a server restart, and a full index
    // rebuild — none of which a migration can express (FR-027).
    expect(normaliseQuery('رف')).toEqual(['رف']);
  });

  it('the definite article alone is not destroyed into nothing', () => {
    // The length guard in stripDefiniteArticle. Without it this token becomes
    // an empty string and a two-letter word beginning with those letters is
    // annihilated — a failure that would look like "search just misses things".
    expect(normaliseQuery('ال')).toEqual(['ال']);
  });

  it('harakat and tatweel are ignored', () => {
    // The one case the collation already handles. Done here anyway so the index
    // does not depend on collation behaviour that a future schema change could
    // alter without anyone connecting the two.
    expect(indexTerms('الكِتَابُ')).toEqual(indexTerms('الكتاب'));
    expect(indexTerms('مُحَمَّد')).toEqual(indexTerms('محمد'));
    // Tatweel is decorative stretching inserted for justification.
    expect(indexTerms('كتـــاب')).toEqual(indexTerms('كتاب'));
  });

  it('the alef variants fold to one token', () => {
    const bare = indexTerms('احمد');

    expect(indexTerms('أحمد')).toEqual(bare);
    expect(indexTerms('إحمد')).toEqual(bare);
    expect(indexTerms('آحمد')).toEqual(bare);
  });

  it('ta marbuta, alef maqsura, and hamza-carrying letters fold', () => {
    expect(indexTerms('مدرسة')).toEqual(indexTerms('مدرسه'));
    expect(indexTerms('مصطفى')).toEqual(indexTerms('مصطفي'));
    expect(indexTerms('مسؤول')).toEqual(indexTerms('مسوول'));
  });

  it('leaves English alone beyond case folding', () => {
    // The fix for Arabic must not cost anything in the other language. If this
    // fails, the normaliser has started guessing.
    const lower = indexTerms('reader');

    expect(indexTerms('Reader')).toEqual(lower);
    expect(indexTerms('READER')).toEqual(lower);
    expect(normaliseQuery('Card Reader')).toEqual(['card', 'reader']);
  });

  it('drops one-character tokens and punctuation', () => {
    expect(normaliseQuery('a card, reader.')).toEqual(['card', 'reader']);
  });
});

describe('index and query normalisation agree', () => {
  /**
   * THE ASSERTION THAT MAKES THE OTHERS MEAN ANYTHING.
   *
   * Every case above proves the pipeline handles a spelling. This proves the
   * SAME pipeline runs at both ends. Normalising indexed text by one set of
   * rules and a query by another produces a word findable by nobody — and it
   * is invisible to any reviewer who does not read Arabic, which is precisely
   * why it needs an assertion rather than a comment.
   */
  const CASES = [
    'كتاب',
    'الكتاب',
    'رف',
    'ال',
    'الكِتَابُ',
    'مُحَمَّد',
    'أحمد',
    'احمد',
    'إحمد',
    'مدرسة',
    'مصطفى',
    'Reader',
    'READER',
    'Card Reader',
    'the card reader keeps rebooting',
    'قارئ البطاقة يعيد التشغيل',
  ];

  it.each(CASES)('normaliseForIndex and normaliseQuery agree on %s', (text) => {
    expect(indexTerms(text)).toEqual([...normaliseQuery(text)].sort());
  });
});

describe('occurrence counting', () => {
  it('counts repeats for ranking, and does not cap them here', () => {
    // The cap belongs to the indexer, which knows what the column holds. A test
    // on this function should be able to see the true count.
    const tokens = normaliseForIndex('card card card reader');

    expect(tokens).toContainEqual({ term: 'card', hits: 3 });
    expect(tokens).toContainEqual({ term: 'reader', hits: 1 });
  });

  it('counts a word and its definite-article form as the same term', () => {
    // Falls out of the folding, and is the behaviour a reader expects: an
    // article that says the word both ways is about that word twice over.
    expect(normaliseForIndex('الكتاب كتاب')).toEqual([{ term: 'كتاب', hits: 2 }]);
  });

  it('deduplicates query terms while preserving the order the reader typed', () => {
    expect(normaliseQuery('reader card reader')).toEqual(['reader', 'card']);
  });

  it('returns nothing for empty or unusable input', () => {
    expect(normaliseQuery('')).toEqual([]);
    expect(normaliseQuery('   ')).toEqual([]);
    expect(normaliseQuery('!!! ?')).toEqual([]);
    expect(normaliseForIndex('')).toEqual([]);
  });
});
