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
 * Suggestion works in Arabic (FR-043).
 *
 * THIS COSTS NOTHING, AND THAT IS THE POINT WORTH RECORDING. Suggestion is
 * `search` with the ticket as the query (research D5), so it runs through the
 * same tokenizer and the same ranking function. Arabic was solved once, in
 * `lib/text-normalise.ts`, and every consumer inherits it.
 *
 * The alternative — a separate matching path for suggestion — would have needed
 * its own Arabic handling, and the two would have drifted. This file exists to
 * prove the inheritance is real rather than assumed, and it is the cheapest
 * test in the phase for what it buys.
 */

const ARABIC_ARTICLE = {
  titleAr: 'قارئ البطاقة يعيد التشغيل',
  bodyAr: 'يعيد قارئ البطاقة التشغيل عند إدخال بطاقة تالفة. استبدل الكابل أولا.',
};

async function suggestFor(subject: string, description: string | null = null) {
  const author = await createTestUser({ roleKey: 'agent' });
  const ticket = await seedTicket({ createdBy: author, subject, description });

  return suggestionService.suggestForTicket(ticket.id);
}

describe('an Arabic ticket receives Arabic articles', () => {
  it('suggests an Arabic article for an Arabic ticket', async () => {
    const article = await makeArticle(ARABIC_ARTICLE);

    const suggestions = await suggestFor('قارئ البطاقة يعيد التشغيل في مكتب الاستقبال');

    expect(suggestions.map((s) => s.articleId)).toEqual([article.id]);
    // FR-005a: the agent is told which language they are being handed, here as
    // everywhere else.
    expect(suggestions[0]?.lang).toBe('ar');
  });

  it('matches across the spellings the platform gets wrong (research D1)', async () => {
    // The definite article, in a suggestion rather than a search. Same
    // tokenizer, so the same fix — which is exactly the inheritance this file
    // is here to demonstrate.
    const article = await makeArticle({
      titleAr: 'إعداد الكتاب المرجعي للجهاز',
      bodyAr: 'يشرح الكتاب المرجعي خطوات ضبط الجهاز وإعادة تشغيله بعد التحديث.',
    });

    // The ticket says the word WITHOUT the definite article. MySQL's own
    // full-text index returns nothing for this.
    const suggestions = await suggestFor('أحتاج كتاب مرجعي لضبط الجهاز وإعادة تشغيله');

    expect(suggestions.map((s) => s.articleId)).toContain(article.id);
  });

  it('picks the language from the TICKET, not from whoever is reading it', async () => {
    // An Arabic ticket surfaces Arabic articles even though the agent may be
    // working in English: the article has to answer the CUSTOMER, and the agent
    // is likely to paste from it.
    await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'The reader power-cycles when the card is inserted.',
    });
    const arabic = await makeArticle(ARABIC_ARTICLE);

    const suggestions = await suggestFor('قارئ البطاقة يعيد التشغيل عند إدخال البطاقة');

    expect(suggestions.map((s) => s.articleId)).toEqual([arabic.id]);
  });

  it('still applies the floor in Arabic', async () => {
    // The empty panel is not an English-only behaviour. A floor that held in
    // one language and not the other would make the Arabic panel the noisy one.
    await makeArticle(ARABIC_ARTICLE);

    expect(await suggestFor('من فضلك ساعدني')).toEqual([]);
  });
});
