import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as suggestionService from '../../src/services/kb-suggestion.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from '../search/helpers.js';
import { seedTicket } from '../tickets/helpers.js';

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
 * THE EMPTY PANEL (FR-041).
 *
 * THE SINGLE MOST IMPORTANT ASSERTION IN THIS STORY, and the least intuitive
 * one to write: this file exists to prove the feature DOES NOTHING under the
 * right conditions.
 *
 * A panel that always shows three articles teaches agents that the panel means
 * nothing. And once they have stopped reading it, IMPROVING THE SUGGESTIONS
 * CANNOT BRING THEM BACK — the habit outlives the fix. A panel that is often
 * empty and occasionally right is one they read.
 *
 * WHAT THESE TESTS CANNOT DO. They fix the two ends: matching nothing produces
 * nothing, matching strongly produces something. They say nothing about the
 * middle, where most real tickets live, and BOTH a floor that is far too low
 * and one that is far too high pass every assertion here. That is why tasks.md
 * carries T098 as a separate tuning pass against real tickets — it is the one
 * number in this phase whose wrong value makes the feature worthless while
 * looking correct.
 */

async function suggestFor(subject: string, description: string | null = null) {
  const author = await createTestUser({ roleKey: 'agent' });
  const ticket = await seedTicket({ createdBy: author, subject, description });

  return suggestionService.suggestForTicket(ticket.id);
}

describe('a ticket that matches nothing gets NOTHING', () => {
  it('returns an empty list for a two-word subject with no bearing on the corpus', async () => {
    await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'The reader power-cycles when the card is inserted.',
    });

    // THE ASSERTION. Not "returns fewer" — returns NONE.
    expect(await suggestFor('please help')).toEqual([]);
  });

  it('returns an empty list rather than the best of a bad lot', async () => {
    // Five articles in the corpus, none about the ticket. The temptation is to
    // show the closest — that temptation is the whole reason for the floor.
    for (let i = 0; i < 5; i += 1) {
      await makeArticle({
        titleEn: `Printer maintenance note ${i}`,
        bodyEn: 'Reseat the ribbon and clear the paper path.',
      });
    }

    expect(await suggestFor('Card reader keeps rebooting')).toEqual([]);
  });

  it('is not fooled by a single incidental word in common', async () => {
    // "reader" appears in both. One shared ordinary word is not a match, and an
    // article suggested on that basis is noise wearing the clothes of an answer.
    await makeArticle({
      titleEn: 'Setting up a barcode reader',
      bodyEn: 'Connect the barcode reader to the second serial port and set the baud rate.',
    });

    expect(await suggestFor('Card reader keeps rebooting')).toEqual([]);
  });

  it('returns nothing when the ticket has no usable words at all', async () => {
    await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'The reader power-cycles when the card is inserted.',
    });

    expect(await suggestFor('?!')).toEqual([]);
    expect(await suggestFor('a')).toEqual([]);
  });

  it('returns nothing when the knowledge base is empty (SC-013)', async () => {
    // The state every installation starts in, and the one nobody tests.
    expect(await suggestFor('Card reader keeps rebooting')).toEqual([]);
  });
});

describe('a ticket that DOES match still gets its article', () => {
  it('does not let the floor swallow a genuine match', async () => {
    // The other end of the same rule. A floor that lets nothing through is as
    // useless as one that lets everything through — it just fails visibly.
    const article = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'The reader power-cycles when the card is inserted. Replace the cable.',
    });

    const suggestions = await suggestFor('Card reader keeps rebooting at the front desk');

    expect(suggestions.map((s) => s.articleId)).toEqual([article.id]);
  });

  it('scores every returned suggestion at or above the floor', async () => {
    // Stated as an invariant rather than a specific case, so it holds however
    // the corpus in a future test happens to be shaped.
    await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'The reader power-cycles when the card is inserted.',
    });
    await makeArticle({
      titleEn: 'Terminal maintenance',
      bodyEn: 'A card reader that keeps rebooting is covered here.',
    });

    const suggestions = await suggestFor('Card reader keeps rebooting');

    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.score).toBeGreaterThanOrEqual(suggestionService.MINIMUM_SCORE);
    }
  });
});
