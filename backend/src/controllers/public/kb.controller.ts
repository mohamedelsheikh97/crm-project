import type { NextFunction, Request, Response } from 'express';

import { notFound } from '../../errors/app-error.js';
import { KbArticle } from '../../models/index.js';
import * as categoryService from '../../services/kb-category.service.js';
import * as articleService from '../../services/kb-article.service.js';
import * as searchService from '../../services/kb-search.service.js';

/**
 * THE PUBLIC HELP CENTRE. THE WHOLE OF THIS PHASE'S NEW ATTACK SURFACE.
 *
 * Read this file assuming a stranger is reading it too, because one is. Every
 * rule below exists because breaking it would be invisible in review.
 *
 * 1. VISIBILITY IS A LITERAL, NEVER A PARAMETER.
 *    `AUDIENCE` and `STATUS` below are constants in this file. There is no
 *    query parameter, header, or body field that can widen them. An endpoint
 *    that accepted "which articles" as input would be ONE SIGNATURE CHANGE away
 *    from serving internal content — and that change would look like a
 *    harmless generalisation to anybody reviewing the diff (research D7,
 *    FR-032c).
 *
 * 2. DRAFT, ARCHIVED, INTERNAL, AND NON-EXISTENT ARE ONE ANSWER.
 *    All four return the same 404 with an identical body, produced by the same
 *    `notFound()` call. A public reader cannot use the response to learn that
 *    an article exists but is not for them.
 *
 * 3. SLUGS, NEVER IDS (research D10). Sequential ids disclose the size of the
 *    corpus and let a stranger walk it one number at a time.
 *
 * 4. NOTHING ABOUT CUSTOMERS, TICKETS, USERS, OR CONFIGURATION APPEARS IN ANY
 *    RESPONSE (FR-035). `toPublicArticle` below is an ALLOW-LIST rather than a
 *    redaction: a field is absent unless somebody put it there deliberately.
 *    Spreading the internal view and deleting the sensitive keys would leak the
 *    next field somebody adds.
 *
 * 5. NO INPUT BEYOND A SEARCH STRING AND A LANGUAGE (FR-032b). No comments, no
 *    ratings, no corrections. That removes moderation, spam, and stored
 *    injection from this phase entirely.
 */

/** Constants, not parameters. See rule 1 above. */
const AUDIENCE = 'customer' as const;
const STATUS = 'published' as const;

/** A public reader reaching page nine is enumerating, not searching. */
const SEARCH_LIMIT = 10;

function language(value: unknown): 'en' | 'ar' {
  return value === 'ar' ? 'ar' : 'en';
}

interface PublicArticle {
  slug: string;
  title: string;
  body: string;
  lang: 'en' | 'ar';
  availableLanguages: Array<'en' | 'ar'>;
  category: { slug: string; name: string | null } | null;
  guide: { slug: string; position: number; total: number } | null;
}

/**
 * AN ALLOW-LIST. Every field here was put here on purpose.
 *
 * No `id`, no `viewCount`, no author, no `updatedAt`, no internal category id.
 * The absences are the requirement (FR-035), and building this by construction
 * rather than by deletion is what stops the next field somebody adds to the
 * article model from appearing here by accident.
 */
function toPublicArticle(
  article: KbArticle,
  lang: 'en' | 'ar',
  category: { slug: string; name: string | null } | null,
  guide: { slug: string; position: number; total: number } | null,
): PublicArticle {
  const available: Array<'en' | 'ar'> = [];
  if (article.title_en && article.body_en) available.push('en');
  if (article.title_ar && article.body_ar) available.push('ar');

  return {
    slug: article.slug!,
    title: (lang === 'ar' ? article.title_ar : article.title_en)!,
    body: (lang === 'ar' ? article.body_ar : article.body_en)!,
    lang,
    // FR-005a holds on the public surface too. A reader handed an English
    // article inside an Arabic help centre must be told which they are getting.
    availableLanguages: available,
    category,
    guide,
  };
}

/**
 * Browse the structure: the categories AND what is in them.
 *
 * THE WHOLE BROWSE TREE IN ONE RESPONSE, rather than a category endpoint and a
 * per-category article endpoint. Three reasons, in order of weight:
 *
 *   - SC-007 requires every published article to be REACHABLE by browsing. A
 *     category list with no way into it is a dead end, and adding a fourth
 *     public endpoint to fix that would widen the attack surface this phase
 *     spent its design keeping narrow.
 *   - A customer on a phone with a broken card reader should not pay a
 *     round-trip to find out a category has three articles in it.
 *   - The corpus is small by construction (spec Assumptions), so the whole tree
 *     is a few dozen rows.
 *
 * ONLY CATEGORIES WITH SOMETHING A CUSTOMER CAN READ ARE LISTED. A category
 * that opens onto nothing is worse than an absent one — the reader spends a
 * click discovering it is empty. Counts are NOT returned: how much the
 * organisation has written is not a stranger's business (FR-035).
 */
export async function categories(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const all = await categoryService.list();

    const withArticles = await Promise.all(
      all.map(async (category) => ({
        category,
        articles: await KbArticle.findAll({
          where: { category_id: category.id, status: STATUS, audience: AUDIENCE },
          // A TOTAL ordering, so two readers see the same shelf.
          order: [
            ['published_at', 'DESC'],
            ['id', 'DESC'],
          ],
        }),
      })),
    );

    res.status(200).json({
      items: withArticles
        .filter((entry) => entry.articles.length > 0)
        .map((entry) => ({
          slug: entry.category.slug,
          nameEn: entry.category.nameEn,
          nameAr: entry.category.nameAr,
          // Slug and title only — an allow-list, like the article payload.
          articles: entry.articles.map((article) => ({
            slug: article.slug,
            titleEn: article.title_en && article.body_en ? article.title_en : null,
            titleAr: article.title_ar && article.body_ar ? article.title_ar : null,
          })),
        })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * One article, by slug.
 *
 * EVERY REFUSAL IS THE SAME `notFound()`. A draft, an archived article, an
 * internal one, and a slug that never existed are indistinguishable from
 * outside — which is FR-032c, and which is why there is exactly one `where`
 * clause below rather than a lookup followed by a series of checks.
 */
export async function article(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const slug = typeof req.params.slug === 'string' ? req.params.slug : '';

    const found = await KbArticle.findOne({
      // ONE query, with the visibility built in. Fetching by slug and then
      // testing `status` would produce the same answer today and a different
      // one the first time somebody added an early return.
      where: { slug, status: STATUS, audience: AUDIENCE },
      include: [{ association: 'category' }],
    });

    if (!found) throw notFound();

    const lang = language(req.query.lang);
    const available: Array<'en' | 'ar'> = [];
    if (found.title_en && found.body_en) available.push('en');
    if (found.title_ar && found.body_ar) available.push('ar');

    // The requested language, or the one the article actually has. A reader
    // asking for Arabic on an English-only article gets the English WITH ITS
    // LANGUAGE LABELLED (FR-005a) rather than an empty page.
    const serving = available.includes(lang) ? lang : available[0];

    // Published with no complete pair should be impossible — the publish gate
    // refuses it (FR-005) — so this is a 404 rather than a 500: from outside,
    // an article with nothing readable in it does not exist.
    if (!serving) throw notFound();

    const category = (found as KbArticle & { category?: { slug: string; name_en: string | null; name_ar: string | null } })
      .category;

    // FR-011c without a second request: the reader's position in the guide
    // travels with the article.
    const guide = await categoryService.guideContextFor(found.id);

    // FR-049. Best-effort and OUTSIDE the response path — see the comment on
    // recordPublicView.
    void articleService.recordPublicView(found.id);

    res.status(200).json(
      toPublicArticle(
        found,
        serving,
        category
          ? {
              slug: category.slug,
              name: (serving === 'ar' ? category.name_ar : category.name_en) ?? null,
            }
          : null,
        guide,
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Public search (FR-032).
 *
 * `audience: AUDIENCE` is the whole of the security of this endpoint, and it is
 * a constant. Note also what is NOT accepted: no `categoryId` beyond a slug, no
 * page number, no limit. Results are CAPPED, NOT PAGED — a public reader
 * reaching page nine is enumerating the corpus rather than searching it.
 */
export async function search(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await searchService.search({
      query: typeof req.query.q === 'string' ? req.query.q : '',
      lang: language(req.query.lang),
      // A LITERAL. Rule 1.
      audience: AUDIENCE,
      limit: SEARCH_LIMIT,
    });

    res.status(200).json({
      // Rebuilt rather than passed through: `articleId` and `categoryId` are
      // internal ids, and a public response carries neither (rule 4).
      items: result.items
        .filter((hit) => hit.slug !== null)
        .map((hit) => ({
          slug: hit.slug,
          title: hit.title,
          lang: hit.lang,
          excerpt: hit.excerpt,
          categoryName: hit.categoryName,
        })),
      // The cross-language offer works here too: a customer searching in Arabic
      // is told that English articles match rather than being handed them.
      otherLanguage: result.otherLanguage,
    });
  } catch (error) {
    next(error);
  }
}
