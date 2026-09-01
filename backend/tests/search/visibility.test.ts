import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KbArticleTerm } from '../../src/models/index.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { makeArticle, reindexNow, searchIds } from './helpers.js';

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
 * ONLY PUBLISHED ARTICLES ARE REACHABLE (FR-018, research D4).
 *
 * The thing worth noticing about these tests is HOW the property holds. There
 * is no `WHERE status = 'published'` in the search query. An unpublished
 * article has no rows in `kb_article_terms` at all, so there is nothing to
 * exclude and no query that can forget to.
 *
 * That distinction is the whole of D4. A filter is a rule every future query
 * must remember; an empty index is a fact none of them can get wrong. The last
 * test in this file asserts the mechanism rather than the symptom, so that a
 * future change from "no rows" to "filter at query time" fails here even if the
 * user-visible behaviour still looks right that day.
 */

async function termCount(articleId: number): Promise<number> {
  return KbArticleTerm.count({ where: { article_id: articleId } });
}

describe('a draft is unfindable', () => {
  it('is not returned by search', async () => {
    const draft = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
      status: 'draft',
    });

    expect(await searchIds('card reader')).not.toContain(draft.id);
  });

  it('has no index rows at all', async () => {
    const draft = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
      status: 'draft',
    });

    expect(await termCount(draft.id)).toBe(0);
  });
});

describe('archiving removes an article from search', () => {
  it('deletes its index rows, so nothing has to remember to exclude it', async () => {
    const article = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
    });

    expect(await searchIds('card reader')).toContain(article.id);
    expect(await termCount(article.id)).toBeGreaterThan(0);

    await article.update({ status: 'archived' });
    await reindexNow(article.id);

    expect(await searchIds('card reader')).not.toContain(article.id);
    expect(await termCount(article.id)).toBe(0);
  });

  it('brings it back when it is restored', async () => {
    const article = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
    });

    await article.update({ status: 'archived' });
    await reindexNow(article.id);
    await article.update({ status: 'published' });
    await reindexNow(article.id);

    expect(await searchIds('card reader')).toContain(article.id);
  });
});

describe('audience is respected', () => {
  it('never returns an internal article to a customer-facing search', async () => {
    // The public help centre calls exactly this, with 'customer' as a literal
    // (research D7). See tests/public/kb-audience.test.ts for the assertion
    // that the public PATH cannot widen it.
    const internal = await makeArticle({
      titleEn: 'Card reader escalation runbook',
      bodyEn: 'Page the on-call engineer.',
      audience: 'internal',
    });

    expect(await searchIds('card reader', { audience: 'customer' })).not.toContain(internal.id);
    expect(await searchIds('card reader', { audience: 'internal' })).toContain(internal.id);
  });

  it('returns a customer article to BOTH audiences', async () => {
    // Widening, never narrowing: an article a customer may read is not thereby
    // one an agent may not.
    const article = await makeArticle({
      titleEn: 'Card reader keeps rebooting',
      bodyEn: 'Replace the cable.',
      audience: 'customer',
    });

    expect(await searchIds('card reader', { audience: 'customer' })).toContain(article.id);
    expect(await searchIds('card reader', { audience: 'internal' })).toContain(article.id);
  });
});

describe('the index holds only what is published', () => {
  it('never has a row for an article that is not published', async () => {
    // THE MECHANISM, not the symptom. If somebody later reintroduces
    // query-time filtering and lets drafts into the index, the behaviour above
    // could still pass while this fails — which is the point of asserting it.
    await makeArticle({ titleEn: 'A draft', bodyEn: 'Words.', status: 'draft' });
    await makeArticle({ titleEn: 'An archived one', bodyEn: 'Words.', status: 'archived' });
    const live = await makeArticle({ titleEn: 'A published one', bodyEn: 'Words.' });

    const rows = await KbArticleTerm.findAll();
    const indexed = new Set(rows.map((row) => row.article_id));

    expect([...indexed]).toEqual([live.id]);
  });
});
