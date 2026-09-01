import { sequelize } from '../../src/config/database.js';
import { KbArticle } from '../../src/models/index.js';
import * as searchService from '../../src/services/kb-search.service.js';
import { createCategory } from '../knowledge/helpers.js';

/**
 * Fixtures for the search tests.
 *
 * These write articles through the MODEL and then call `reindex` directly,
 * rather than going through the publish endpoint. That is deliberate: these
 * tests are about matching and ranking, and routing every fixture through the
 * publish gate would mean a failure in the gate showed up here as a search bug.
 */

let counter = 0;

export interface ArticleFields {
  titleEn?: string | null;
  bodyEn?: string | null;
  titleAr?: string | null;
  bodyAr?: string | null;
  audience?: 'internal' | 'customer';
  status?: 'draft' | 'published' | 'archived';
  categoryId?: number;
  updatedAt?: Date;
}

export async function makeArticle(fields: ArticleFields): Promise<KbArticle> {
  counter += 1;

  const categoryId = fields.categoryId ?? (await createCategory()).id;
  const status = fields.status ?? 'published';

  const article = await KbArticle.create({
    category_id: categoryId,
    title_en: fields.titleEn ?? null,
    body_en: fields.bodyEn ?? null,
    title_ar: fields.titleAr ?? null,
    body_ar: fields.bodyAr ?? null,
    audience: fields.audience ?? 'internal',
    status,
    // A draft has no slug (research D10); anything else does.
    slug: status === 'draft' ? null : `article-${counter}-${Date.now()}`,
    published_at: status === 'draft' ? null : new Date(),
  });

  if (fields.updatedAt) {
    await article.update({ updated_at: fields.updatedAt }, { silent: true });
  }

  await sequelize.transaction((transaction) => searchService.reindex(article.id, transaction));

  return article;
}

export async function reindexNow(articleId: number): Promise<void> {
  await sequelize.transaction((transaction) => searchService.reindex(articleId, transaction));
}

export async function searchIds(
  query: string,
  options: { lang?: 'en' | 'ar'; audience?: 'internal' | 'customer' } = {},
): Promise<number[]> {
  const result = await searchService.search({
    query,
    lang: options.lang ?? 'en',
    audience: options.audience ?? 'internal',
  });

  return result.items.map((hit) => hit.articleId);
}
