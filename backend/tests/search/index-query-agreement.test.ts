import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import { KbArticle } from '../../src/models/index.js';
import * as searchService from '../../src/services/kb-search.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { createCategory } from '../knowledge/helpers.js';

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
 * THE TEST THAT PROVES THE PHASE'S CENTRAL CLAIM.
 *
 * `text-normalise.test.ts` proves the tokenizer folds spellings correctly. This
 * proves the whole path does: an article stored with one spelling is FOUND by a
 * query for another, end to end, through the database.
 *
 * These are the exact cases research D1 measured MySQL's own full-text index
 * returning ZERO matches for. If this file is green and someone later swaps the
 * index for `MATCH ... AGAINST`, it goes red immediately — which is the whole
 * reason to assert it here rather than trust the unit test upstream.
 */

async function publish(fields: {
  titleEn?: string | null;
  bodyEn?: string | null;
  titleAr?: string | null;
  bodyAr?: string | null;
  audience?: 'internal' | 'customer';
}): Promise<KbArticle> {
  const category = await createCategory();

  const article = await KbArticle.create({
    category_id: category.id,
    title_en: fields.titleEn ?? null,
    body_en: fields.bodyEn ?? null,
    title_ar: fields.titleAr ?? null,
    body_ar: fields.bodyAr ?? null,
    audience: fields.audience ?? 'internal',
    status: 'published',
    slug: `article-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    published_at: new Date(),
  });

  await sequelize.transaction((transaction) => searchService.reindex(article.id, transaction));

  return article;
}

async function findIds(query: string, lang: 'en' | 'ar' = 'ar'): Promise<number[]> {
  const result = await searchService.search({ query, lang, audience: 'internal' });
  return result.items.map((hit) => hit.articleId);
}

describe('a query finds an article spelled differently (research D1)', () => {
  it('finds an article containing the definite-article form, searching WITHOUT it', async () => {
    // MySQL FULLTEXT: 0 matches. This is the single case the whole of research
    // D1 exists for, and it has no configuration fix on that platform.
    const article = await publish({
      titleAr: 'الكتاب المرجعي',
      bodyAr: 'يشرح الكتاب كيفية ضبط الجهاز.',
    });

    expect(await findIds('كتاب')).toEqual([article.id]);
  });

  it('finds an article containing the bare form, searching WITH the definite article', async () => {
    // MySQL FULLTEXT: 0 matches, in this direction too.
    const article = await publish({ titleAr: 'كتاب الإعدادات', bodyAr: 'دليل الضبط.' });

    expect(await findIds('الكتاب')).toEqual([article.id]);
  });

  it('finds a genuine two-letter Arabic word', async () => {
    // MySQL FULLTEXT: dropped, because innodb_ft_min_token_size defaults to 3.
    // Raising it needs a global variable, a restart, and a full index rebuild —
    // none of which a migration can express (FR-027).
    const article = await publish({ titleAr: 'ترتيب الرف', bodyAr: 'ضع الجهاز على الرف العلوي.' });

    expect(await findIds('رف')).toEqual([article.id]);
  });

  it('ignores harakat on either side', async () => {
    const article = await publish({ titleAr: 'الكِتَابُ المرجعي', bodyAr: 'نص.' });

    expect(await findIds('كتاب')).toEqual([article.id]);
    expect(await findIds('الكِتَابُ')).toEqual([article.id]);
  });

  it('folds the alef variants', async () => {
    const article = await publish({ titleAr: 'دليل أحمد', bodyAr: 'نص.' });

    expect(await findIds('احمد')).toEqual([article.id]);
    expect(await findIds('إحمد')).toEqual([article.id]);
  });

  it('does the same for English, unremarkably', async () => {
    // The Arabic fix must cost nothing in the other language.
    const article = await publish({
      titleEn: 'Card Reader troubleshooting',
      bodyEn: 'Power-cycle the READER.',
    });

    expect(await findIds('reader', 'en')).toEqual([article.id]);
    expect(await findIds('Card', 'en')).toEqual([article.id]);
  });
});

describe('a query for something absent finds nothing', () => {
  it('returns an empty list rather than a weak guess', async () => {
    await publish({ titleEn: 'Card reader', bodyEn: 'Replace the cable.' });

    const result = await searchService.search({
      query: 'aardvark taxidermy',
      lang: 'en',
      audience: 'internal',
    });

    expect(result.items).toEqual([]);
  });

  it('returns nothing for a query with no usable tokens', async () => {
    await publish({ titleEn: 'Card reader', bodyEn: 'Replace the cable.' });

    // A query that normalises to no terms must not fall through to "everything".
    for (const query of ['', '   ', '?', '!!!']) {
      const result = await searchService.search({ query, lang: 'en', audience: 'internal' });
      expect(result.items).toEqual([]);
    }
  });
});
