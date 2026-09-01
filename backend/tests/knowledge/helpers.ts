import { KbArticle, KbCategory } from '../../src/models/index.js';

/**
 * Fixtures for the knowledge-base tests.
 *
 * NO CATEGORIES OR ARTICLES ARE SEEDED by the application (see quickstart): a
 * knowledge base's content is entirely the organisation's, and inventing a
 * taxonomy would be guessing at their business. So every test that needs
 * content builds it, and these helpers exist so the tests can say what they
 * mean rather than repeating a create-article dance.
 */

let sequence = 0;

export async function createCategory(
  overrides: Partial<{
    nameEn: string | null;
    nameAr: string | null;
    slug: string;
    ticketCategory: string | null;
    position: number;
  }> = {},
): Promise<KbCategory> {
  sequence += 1;

  return KbCategory.create({
    name_en: overrides.nameEn === undefined ? `Category ${sequence}` : overrides.nameEn,
    name_ar: overrides.nameAr === undefined ? `تصنيف ${sequence}` : overrides.nameAr,
    slug: overrides.slug ?? `category-${sequence}`,
    ticket_category: overrides.ticketCategory ?? null,
    position: overrides.position ?? sequence,
  });
}

export const ENGLISH_ARTICLE = {
  titleEn: 'Card reader keeps rebooting',
  bodyEn: 'The reader power-cycles when the card is inserted. Replace the cable first.',
};

export const ARABIC_ARTICLE = {
  titleAr: 'قارئ البطاقة يعيد التشغيل',
  bodyAr: 'يعيد القارئ التشغيل عند إدخال البطاقة. استبدل الكابل أولا.',
};

/**
 * Creates an article directly through the model, for tests that need one to
 * exist without exercising the create endpoint. Nothing here goes through the
 * publish gate — a test that cares about publishing calls the endpoint.
 */
export async function createArticle(
  categoryId: number,
  overrides: Partial<{
    titleEn: string | null;
    titleAr: string | null;
    bodyEn: string | null;
    bodyAr: string | null;
    audience: 'internal' | 'customer';
    createdByUserId: number | null;
  }> = {},
): Promise<KbArticle> {
  return KbArticle.create({
    category_id: categoryId,
    title_en: overrides.titleEn === undefined ? ENGLISH_ARTICLE.titleEn : overrides.titleEn,
    title_ar: overrides.titleAr ?? null,
    body_en: overrides.bodyEn === undefined ? ENGLISH_ARTICLE.bodyEn : overrides.bodyEn,
    body_ar: overrides.bodyAr ?? null,
    audience: overrides.audience ?? 'internal',
    created_by_user_id: overrides.createdByUserId ?? null,
    updated_by_user_id: overrides.createdByUserId ?? null,
  });
}
