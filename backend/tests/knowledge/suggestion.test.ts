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
 * PLAN.md's Definition of done: "the system proactively suggests one on a
 * matching ticket" (User Story 3, FR-037 to FR-045).
 *
 * The mechanism is deliberately unexciting — it is `search`, with the ticket as
 * the query (research D5). What is worth testing is not that matching works
 * (the search suite covers that) but that the RIGHT THINGS reach the panel and
 * the wrong things do not.
 */

async function suggestionsFor(subject: string, description: string | null = null) {
  const author = await createTestUser({ roleKey: 'agent' });
  const ticket = await seedTicket({ createdBy: author, subject, description });

  return suggestionService.suggestForTicket(ticket.id);
}

describe('a ticket receives articles about what it says', () => {
  it('suggests an article whose title matches the ticket subject', async () => {
    const article = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'The reader power-cycles when the card is inserted. Replace the cable.',
    });

    const suggestions = await suggestionsFor('Card reader keeps rebooting on the front desk');

    expect(suggestions.map((s) => s.articleId)).toContain(article.id);
  });

  it('reads the description as well as the subject', async () => {
    // A subject is often useless ("urgent", "help"). The description is where
    // the customer actually says what happened.
    const article = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'The reader power-cycles when the card is inserted.',
    });

    const suggestions = await suggestionsFor(
      'Urgent',
      'The card reader keeps rebooting whenever a card is inserted.',
    );

    expect(suggestions.map((s) => s.articleId)).toContain(article.id);
  });

  it('orders them best first', async () => {
    // BOTH of these clear the floor. An earlier draft of this test used an
    // article that merely LISTED "the card reader" among six components, and it
    // was correctly excluded — the floor doing its job. Ordering and the floor
    // are separate properties, and this test is about the first; the second is
    // suggestion-floor.test.ts, where it belongs.
    const buried = await makeArticle({
      titleEn: 'Terminal maintenance',
      bodyEn: 'A card reader that keeps rebooting is covered under terminal maintenance.',
    });

    const named = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'The reader power-cycles when the card is inserted.',
    });

    const suggestions = await suggestionsFor('Card reader keeps rebooting');

    expect(suggestions[0]?.articleId).toBe(named.id);
    expect(suggestions.map((s) => s.articleId)).toContain(buried.id);
  });

  it('gives two callers the same order (SC-008)', async () => {
    // Two agents open the same ticket. They must not disagree about what the
    // system suggested, or neither can tell which of them is seeing a bug.
    for (let i = 0; i < 4; i += 1) {
      await makeArticle({
        titleEn: `Card reader note ${i}`,
        bodyEn: 'The reader power-cycles when the card is inserted.',
      });
    }

    const author = await createTestUser({ roleKey: 'agent' });
    const ticket = await seedTicket({ createdBy: author, subject: 'Card reader keeps rebooting' });

    const [first, second] = await Promise.all([
      suggestionService.suggestForTicket(ticket.id),
      suggestionService.suggestForTicket(ticket.id),
    ]);

    expect(second.map((s) => s.articleId)).toEqual(first.map((s) => s.articleId));
  });

  it('caps how many it offers', async () => {
    // More than a handful beside a ticket somebody is already working is not a
    // suggestion, it is a second search results page nobody asked for.
    for (let i = 0; i < 12; i += 1) {
      await makeArticle({
        titleEn: `Card reader keeps rebooting ${i}`,
        bodyEn: 'The reader power-cycles when the card is inserted.',
      });
    }

    const suggestions = await suggestionsFor('Card reader keeps rebooting');

    expect(suggestions.length).toBeLessThanOrEqual(suggestionService.MAX_SUGGESTIONS);
  });
});

describe('a ticket that no longer exists', () => {
  it('returns nothing rather than throwing', async () => {
    expect(await suggestionService.suggestForTicket(999999)).toEqual([]);
  });
});
