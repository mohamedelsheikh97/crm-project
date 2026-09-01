import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as suggestionService from '../../src/services/kb-suggestion.service.js';
import { createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle, reindexNow } from '../search/helpers.js';
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
 * SUGGESTIONS ARE COMPUTED ON READ AND NEVER STORED (FR-042, research D5).
 *
 * The failure this prevents: an article is archived because it was wrong, and
 * a stored suggestion keeps offering it to agents for weeks. Nobody notices,
 * because the suggestion looks exactly like a correct one.
 *
 * Because they are recomputed, an archive takes effect on the NEXT READ — which
 * is what the second test here asserts. And because only published articles
 * have index rows (research D4), the property comes for free rather than from a
 * filter somebody has to remember to write.
 */

const SUBJECT = 'Card reader keeps rebooting at the front desk';

const FIELDS = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'The reader power-cycles when the card is inserted. Replace the cable.',
};

async function suggest(subject = SUBJECT) {
  const author = await createTestUser({ roleKey: 'agent' });
  const ticket = await seedTicket({ createdBy: author, subject });

  return suggestionService.suggestForTicket(ticket.id);
}

describe('unpublished articles are never suggested', () => {
  it('never suggests a draft', async () => {
    await makeArticle({ ...FIELDS, status: 'draft' });

    expect(await suggest()).toEqual([]);
  });

  it('never suggests an archived article', async () => {
    await makeArticle({ ...FIELDS, status: 'archived' });

    expect(await suggest()).toEqual([]);
  });
});

describe('archiving takes effect on the next read (FR-042)', () => {
  it('stops suggesting an article the moment it is archived', async () => {
    const article = await makeArticle(FIELDS);

    expect((await suggest()).map((s) => s.articleId)).toEqual([article.id]);

    await article.update({ status: 'archived' });
    await reindexNow(article.id);

    // No cache to invalidate, no stored row to clean up. The suggestion simply
    // is not computed any more.
    expect(await suggest()).toEqual([]);
  });

  it('starts suggesting again when it is restored', async () => {
    const article = await makeArticle(FIELDS);

    await article.update({ status: 'archived' });
    await reindexNow(article.id);
    await article.update({ status: 'published' });
    await reindexNow(article.id);

    expect((await suggest()).map((s) => s.articleId)).toEqual([article.id]);
  });

  it('follows an edit, so a rewritten article stops matching the old ticket', async () => {
    const article = await makeArticle(FIELDS);

    expect((await suggest()).map((s) => s.articleId)).toEqual([article.id]);

    await article.update({
      title_en: 'Printer ribbon replacement',
      body_en: 'Open the cover and reseat the ribbon cartridge.',
    });
    await reindexNow(article.id);

    expect(await suggest()).toEqual([]);
  });
});

describe('nothing is written when a suggestion is computed', () => {
  it('leaves kb_ticket_articles empty', async () => {
    // That table holds DECISIONS — an agent pinning an article, or a rule
    // acting. A computed guess is not a decision, and writing one there would
    // make the two indistinguishable a week later.
    const { KbTicketArticle } = await import('../../src/models/index.js');

    await makeArticle(FIELDS);
    await suggest();

    expect(await KbTicketArticle.count()).toBe(0);
  });
});
