import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as suggestionService from '../../src/services/kb-suggestion.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle } from '../search/helpers.js';
import { createCategory } from './helpers.js';
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
 * The category boost (FR-040, research D6).
 *
 * A BOOST, NEVER A FILTER, and the second test in this file is the one that
 * matters. FR-040 says "prefer", not "restrict" — and the difference is the
 * difference between a helpful bias and a blind spot.
 *
 * A technical article CAN be the right answer to a billing ticket: "the payment
 * failed because the card reader rejected the chip" arrives filed under
 * billing and is answered by a hardware article. A filter would make that
 * answer unreachable, and nobody would ever know it existed.
 *
 * A multiplier tips a close decision without overruling a clear one.
 */

const SUBJECT = 'Card reader keeps rebooting at the front desk';

const FIELDS = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'The reader power-cycles when the card is inserted. Replace the cable.',
};

async function suggestFor(category: 'billing' | 'technical' | 'general', subject = SUBJECT) {
  const author = await createTestUser({ roleKey: 'agent' });
  const ticket = await seedTicket({ createdBy: author, subject, category });

  return suggestionService.suggestForTicket(ticket.id);
}

describe('a matching category is preferred', () => {
  it('ranks an article in the mapped category above an equally-matching one', async () => {
    // Identical text, so the scores are identical before the boost. Everything
    // that separates them is the category mapping.
    const mapped = await createCategory({ ticketCategory: 'technical', slug: 'hardware' });
    const unmapped = await createCategory({ ticketCategory: null, slug: 'misc' });

    const inMisc = await makeArticle({ ...FIELDS, categoryId: unmapped.id });
    const inHardware = await makeArticle({ ...FIELDS, categoryId: mapped.id });

    const suggestions = await suggestFor('technical');

    expect(suggestions[0]?.articleId).toBe(inHardware.id);
    expect(suggestions.map((s) => s.articleId)).toContain(inMisc.id);
  });
});

describe('a non-matching category is NOT excluded', () => {
  it('still suggests a technical article for a billing ticket (FR-040 says "prefer")', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. If somebody later "tidies" the boost
    // into a WHERE clause, this goes red — and without it, that change would
    // look like a harmless optimisation.
    const hardware = await createCategory({ ticketCategory: 'technical', slug: 'hardware' });
    const article = await makeArticle({ ...FIELDS, categoryId: hardware.id });

    const suggestions = await suggestFor(
      'billing',
      'The payment failed because the card reader keeps rebooting',
    );

    expect(suggestions.map((s) => s.articleId)).toContain(article.id);
  });

  it('suggests normally when no knowledge category maps to the ticket category at all', async () => {
    // Null mapping is the honest answer for a category like "Getting started",
    // and it must not make those articles unsuggestable.
    const unmapped = await createCategory({ ticketCategory: null, slug: 'getting-started' });
    const article = await makeArticle({ ...FIELDS, categoryId: unmapped.id });

    expect((await suggestFor('technical')).map((s) => s.articleId)).toEqual([article.id]);
  });
});

describe('the boost cannot overrule a clear difference', () => {
  it('does not put a weak in-category article above a strong out-of-category one', async () => {
    // The boost is a multiplier, not an override. An article named after the
    // problem beats one that merely mentions it, whatever it is filed under.
    const mapped = await createCategory({ ticketCategory: 'technical', slug: 'hardware' });
    const unmapped = await createCategory({ ticketCategory: null, slug: 'misc' });

    // Enough to clear the floor — otherwise this test would pass for the wrong
    // reason, asserting that a boost failed to promote an article that was
    // never eligible.
    const weakInCategory = await makeArticle({
      titleEn: 'Terminal maintenance',
      bodyEn:
        'A card reader that keeps rebooting at the front desk is covered under terminal ' +
        'maintenance.',
      categoryId: mapped.id,
    });

    const strongOutOfCategory = await makeArticle({ ...FIELDS, categoryId: unmapped.id });

    const suggestions = await suggestFor('technical');

    expect(suggestions[0]?.articleId).toBe(strongOutOfCategory.id);
    expect(suggestions.map((s) => s.articleId)).toContain(weakInCategory.id);
  });
});
