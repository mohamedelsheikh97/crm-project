import { QueryTypes, type Transaction } from 'sequelize';

import { sequelize } from '../config/database.js';
import { normaliseForIndex, normaliseQuery } from '../lib/text-normalise.js';
import { KbArticle, KbArticleTerm } from '../models/index.js';
import type { KbAudience } from '../models/kb-article.model.js';

/**
 * Indexing and searching (Phase 7, research D1-D4, contracts/search-contract.md).
 *
 * THE PROJECT OWNS ITS SEARCH BECAUSE THE DATABASE MEASURABLY CANNOT DO IT IN
 * ARABIC. See `lib/text-normalise.ts` for the measurements. This file is the
 * other half: rows of normalised tokens, and a ranking function over them.
 *
 * THE SEAM. If a later phase replaces this with a real search engine, it
 * replaces `normaliseForIndex` plus the two functions below. Nothing above them
 * knows how matching works — the controllers pass a query and a visibility and
 * receive scored hits.
 */

// --- Ranking constants ----------------------------------------------------

/**
 * ONE NAMED CONSTANT, so tuning is a one-line change (research, open question 1)
 * and so "why did this rank first?" has a readable answer.
 *
 * THE FIELD WEIGHT stops an article that mentions a word once in passing
 * outranking the article NAMED after that word. Ten to one is deliberately
 * lopsided: a title is a claim about what the whole document is for, and a body
 * mention is not.
 *
 * DELIBERATELY NOT TF-IDF OR BM25. Both need corpus statistics maintained
 * across every write, and at this corpus size they would reorder results
 * without measurably improving them — while making the ordering much harder to
 * explain to somebody who disagrees with it.
 */
export const FIELD_WEIGHTS = { title: 10, body: 1 } as const;

/**
 * A word repeated fifty times must not dominate a document that is about
 * something else. Three occurrences already say "this article is about this";
 * the fiftieth says nothing the third did not.
 */
export const HITS_CAP = 5;

/** A reader who reaches result forty is not searching any more. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Enough of the sentence to judge by, without becoming the article. */
const EXCERPT_RADIUS = 90;

// --- Indexing -------------------------------------------------------------

type Lang = 'en' | 'ar';

interface TermRow {
  article_id: number;
  lang: Lang;
  field: 'title' | 'body';
  term: string;
  hits: number;
}

function rowsFor(articleId: number, lang: Lang, field: 'title' | 'body', text: string | null) {
  if (!text) return [];

  return normaliseForIndex(text).map((token) => ({
    article_id: articleId,
    lang,
    field,
    term: token.term,
    // The cap belongs here rather than in the tokenizer: this is the layer that
    // knows what the column holds and what the ranking can stand.
    hits: Math.min(token.hits, HITS_CAP),
  }));
}

/**
 * Rebuild one article's index rows.
 *
 * THREE RULES, EACH MAKING A REQUIREMENT STRUCTURAL RATHER THAN CHECKED:
 *
 *  1. ONLY PUBLISHED ARTICLES ARE INDEXED. Called on a draft or an archived
 *     article this writes nothing and deletes whatever exists. FR-004 and
 *     FR-018 then need no query-side check anywhere — there is nothing to find,
 *     on any of the four reader surfaces, so no query can forget.
 *  2. THE REBUILD RUNS IN THE CALLER'S TRANSACTION. Delete then insert. "Saved
 *     but not searchable" and "searchable under its old text" are both
 *     unrepresentable, which matters because both failures are silent.
 *  3. EACH LANGUAGE IS INDEXED SEPARATELY, into rows carrying `lang`. A
 *     one-language article produces rows for that language only — which is what
 *     makes FR-029's cross-language near-miss a second query rather than a
 *     heuristic.
 *
 * REBUILT, NOT DIFFED. A diff is an optimisation on a table this small, and it
 * introduces the one bug this design exists to make impossible: an index that
 * disagrees with its article.
 */
export async function reindex(articleId: number, transaction: Transaction): Promise<void> {
  const article = await KbArticle.findByPk(articleId, { transaction });

  await KbArticleTerm.destroy({ where: { article_id: articleId }, transaction });

  if (!article || article.status !== 'published') return;

  const rows: TermRow[] = [
    ...rowsFor(articleId, 'en', 'title', article.title_en),
    ...rowsFor(articleId, 'en', 'body', article.body_en),
    ...rowsFor(articleId, 'ar', 'title', article.title_ar),
    ...rowsFor(articleId, 'ar', 'body', article.body_ar),
  ];

  if (rows.length === 0) return;

  await KbArticleTerm.bulkCreate(rows, { transaction });
}

/**
 * Explicit removal, for callers that know an article is going away and do not
 * want to load it. `reindex` already does this for every lifecycle transition;
 * this exists so the intent can be stated where that is clearer.
 */
export async function removeFromIndex(articleId: number, transaction: Transaction): Promise<void> {
  await KbArticleTerm.destroy({ where: { article_id: articleId }, transaction });
}

// --- Searching ------------------------------------------------------------

export interface SearchOptions {
  query: string;
  lang: Lang;
  /**
   * DECIDED BY THE CALLER'S SURFACE, NEVER BY THE REQUEST (research D7,
   * FR-032c).
   *
   * The public controller passes `'customer'` as a literal. A public endpoint
   * that accepted "which articles" as input would be one signature change away
   * from serving internal content, and that change would look harmless in
   * review — which is exactly why this is a parameter of the function and never
   * a parameter of the HTTP request.
   */
  audience: KbAudience;
  categoryId?: number;
  limit?: number;
  /**
   * A multiplier per KB CATEGORY id, applied after scoring — the suggestion
   * boost (research D6).
   *
   * KEYED BY CATEGORY, NOT BY ARTICLE, and the distinction is worth stating
   * because getting it wrong is silent: the lookup simply misses, every
   * multiplier is 1, and the boost does nothing while the code reads as though
   * it works. The relationship FR-040 describes is between a KB category and a
   * ticket category, so the category is the natural key.
   */
  categoryBoosts?: ReadonlyMap<number, number>;
  /** Ids to leave out — the ticket's already-pinned articles, for instance. */
  exclude?: readonly number[];
}

export interface SearchHit {
  articleId: number;
  slug: string | null;
  title: string;
  /** Which language's content matched — shown to the reader (FR-005a). */
  lang: Lang;
  /** The fragment showing WHY it matched (FR-021). */
  excerpt: string;
  categoryId: number;
  categoryName: string | null;
  score: number;
}

export interface SearchResult {
  items: SearchHit[];
  /**
   * FR-029. Present ONLY when the reader's own language returned nothing and
   * the other one has matches. Carries a COUNT, never the articles: offering to
   * look is not the same as handing somebody content in a language they did not
   * ask for, unlabelled — the thing FR-005a exists to prevent.
   */
  otherLanguage: { lang: Lang; count: number } | null;
}

interface ScoredRow {
  article_id: number;
  score: string | number;
  matched: string | number;
}

/**
 * The ranking function (research D3):
 *
 *   score = ( SUM over matched query terms of weight(field) * hits )
 *           * ( matchedTerms / totalQueryTerms )
 *
 * THE FRACTION-MATCHED MULTIPLIER is the half people forget. Without it a long
 * article containing one of the reader's five words outranks a short one
 * containing all five, because it simply has more text. With it, matching the
 * whole query is worth more than matching a lot of one word.
 *
 * The aggregation happens in SQL because the alternative is loading every term
 * row for every candidate article into Node to add them up.
 */
async function scoreArticles(
  terms: string[],
  lang: Lang,
  audience: KbAudience,
  categoryId: number | undefined,
  exclude: readonly number[],
): Promise<ScoredRow[]> {
  if (terms.length === 0) return [];

  const rows = await sequelize.query<ScoredRow>(
    `SELECT t.article_id,
            SUM(CASE t.field WHEN 'title' THEN :titleWeight ELSE :bodyWeight END * t.hits) AS score,
            COUNT(DISTINCT t.term) AS matched
       FROM kb_article_terms t
       JOIN kb_articles a ON a.id = t.article_id
      WHERE t.term IN (:terms)
        AND t.lang = :lang
        -- The visibility predicate. Note that 'published' is NOT here: an
        -- unpublished article has no rows in this table at all (research D4),
        -- so there is nothing to exclude and no query that can forget to.
        AND a.audience IN (:audiences)
        ${categoryId ? 'AND a.category_id = :categoryId' : ''}
        ${exclude.length > 0 ? 'AND a.id NOT IN (:exclude)' : ''}
      GROUP BY t.article_id`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        terms,
        lang,
        titleWeight: FIELD_WEIGHTS.title,
        bodyWeight: FIELD_WEIGHTS.body,
        // An INTERNAL reader sees both; a customer sees only customer-facing
        // articles. Widening, never narrowing: an article an agent may read is
        // not thereby one a customer may.
        audiences: audience === 'internal' ? ['internal', 'customer'] : ['customer'],
        categoryId,
        exclude,
      },
    },
  );

  return rows;
}

/** Just the count, for the cross-language near-miss. No scoring, no loading. */
async function countMatches(
  terms: string[],
  lang: Lang,
  audience: KbAudience,
): Promise<number> {
  if (terms.length === 0) return 0;

  const rows = await sequelize.query<{ total: number }>(
    `SELECT COUNT(DISTINCT t.article_id) AS total
       FROM kb_article_terms t
       JOIN kb_articles a ON a.id = t.article_id
      WHERE t.term IN (:terms) AND t.lang = :lang AND a.audience IN (:audiences)`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        terms,
        lang,
        audiences: audience === 'internal' ? ['internal', 'customer'] : ['customer'],
      },
    },
  );

  return Number(rows[0]?.total ?? 0);
}

/**
 * The fragment showing WHY a result matched (FR-021).
 *
 * This is what lets a reader choose between five results without opening five
 * of them, which is the difference between a search that saves time and one
 * that moves the work somewhere else.
 *
 * Returns a plain string. The interface highlights; the service does not emit
 * markup, because a service that returns HTML has decided how it will be
 * rendered and has to be trusted not to have decided wrongly.
 */
function excerptFor(body: string | null, title: string, terms: string[]): string {
  const source = body ?? title;
  if (!source) return '';

  // Match on the NORMALISED form so the excerpt lands on the word the reader
  // actually matched, including when their spelling differed from the article's
  // — which for Arabic is the common case, not the exotic one.
  const words = source.split(/\s+/);
  let hitIndex = -1;

  for (let i = 0; i < words.length && hitIndex === -1; i += 1) {
    const normalised = normaliseQuery(words[i] ?? '');
    if (normalised.some((term) => terms.includes(term))) hitIndex = i;
  }

  if (hitIndex === -1) return source.slice(0, EXCERPT_RADIUS * 2).trim();

  // Walk outward by characters from the matched word, so the fragment reads as
  // a sentence rather than starting mid-phrase.
  const before = words.slice(0, hitIndex).join(' ');
  const start = Math.max(0, before.length - EXCERPT_RADIUS);
  const excerpt = source.slice(start, start + EXCERPT_RADIUS * 2).trim();

  return (start > 0 ? '…' : '') + excerpt + (start + EXCERPT_RADIUS * 2 < source.length ? '…' : '');
}

function titleFor(article: KbArticle, lang: Lang): string {
  return (lang === 'ar' ? article.title_ar : article.title_en) ?? '';
}

function bodyFor(article: KbArticle, lang: Lang): string | null {
  return lang === 'ar' ? article.body_ar : article.body_en;
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(value as number), 1), MAX_LIMIT);
}

export async function search(options: SearchOptions): Promise<SearchResult> {
  const terms = normaliseQuery(options.query ?? '');

  if (terms.length === 0) return { items: [], otherLanguage: null };

  const exclude = options.exclude ?? [];
  const scored = await scoreArticles(
    terms,
    options.lang,
    options.audience,
    options.categoryId,
    exclude,
  );

  if (scored.length === 0) {
    // FR-029: the reader's own language found nothing. Look in the other one
    // and REPORT WHAT WE FOUND rather than substituting it.
    const otherLang: Lang = options.lang === 'ar' ? 'en' : 'ar';
    const count = await countMatches(terms, otherLang, options.audience);

    return { items: [], otherLanguage: count > 0 ? { lang: otherLang, count } : null };
  }

  const articles = await KbArticle.findAll({
    where: { id: scored.map((row) => row.article_id) },
    include: [{ association: 'category' }],
  });

  const byId = new Map(articles.map((article) => [article.id, article]));

  const hits: SearchHit[] = [];

  for (const row of scored) {
    const article = byId.get(row.article_id);
    if (!article) continue;

    const title = titleFor(article, options.lang);
    // An article whose OTHER language matched has no title in this one. It
    // should never reach here — the index rows carry `lang` — but a result the
    // reader cannot read is worse than one fewer result, so it is dropped.
    if (!title) continue;

    const fraction = Number(row.matched) / terms.length;
    const boost = options.categoryBoosts?.get(article.category_id) ?? 1;

    hits.push({
      articleId: article.id,
      slug: article.slug,
      title,
      lang: options.lang,
      excerpt: excerptFor(bodyFor(article, options.lang), title, terms),
      categoryId: article.category_id,
      categoryName:
        (article as KbArticle & { category?: { name_en: string | null; name_ar: string | null } })
          .category?.[options.lang === 'ar' ? 'name_ar' : 'name_en'] ?? null,
      score: Number(row.score) * fraction * boost,
    });
  }

  /**
   * A TOTAL ORDERING, and this is what SC-008 tests.
   *
   * Score, then most-recently-updated, then id. "Whatever the database
   * returned" is not an ordering: two agents opening the same ticket would see
   * different orders, disagree about what the system suggested, and have no way
   * to tell which of them was looking at a bug.
   */
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const aArticle = byId.get(a.articleId)!;
    const bArticle = byId.get(b.articleId)!;
    const byUpdated = bArticle.updated_at.getTime() - aArticle.updated_at.getTime();

    return byUpdated !== 0 ? byUpdated : b.articleId - a.articleId;
  });

  return { items: hits.slice(0, clampLimit(options.limit)), otherLanguage: null };
}
