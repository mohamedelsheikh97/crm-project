import { Op, type Transaction } from 'sequelize';

import { sequelize } from '../config/database.js';
import { now } from '../lib/clock.js';
import {
  articleIncomplete,
  notFound,
  staleRecord,
  validationError,
  type ErrorDetail,
} from '../errors/app-error.js';
import { KbArticle, KbCategory, User } from '../models/index.js';
import type { KbArticleStatus, KbAudience } from '../models/kb-article.model.js';
import { KB_AUDIENCES } from '../models/kb-article.model.js';
import * as auditService from './audit.service.js';
import * as authorizationService from './authorization.service.js';
import * as searchService from './kb-search.service.js';
import type { UserActor as Actor, AuditContext, Paged } from './ticket.service.js';
import { clampPageSize } from './ticket.service.js';

/**
 * Articles: writing them, filing them, and deciding when they go live
 * (Phase 7, User Story 2).
 *
 * THE PUBLISH GATE IS THE ONLY QUALITY CONTROL THIS CONTENT HAS. There is no
 * review workflow, no approval chain, and no version history to fall back on
 * (spec Assumptions). Everything in this file that looks strict is strict for
 * that reason: once an article is published it is the organisation speaking, to
 * colleagues and possibly to customers, and the only moment anybody is required
 * to look at it is the moment it is published.
 *
 * FOUR PROPERTIES ARE STRUCTURAL RATHER THAN CHECKED, and each removes a class
 * of bug rather than guarding against one:
 *
 *   - A new article is a DRAFT. `status` defaults to it in the schema and no
 *     path here accepts a status on create (FR-004).
 *   - A new article is INTERNAL. Same (FR-031). The safe default for content
 *     nobody has considered is "colleagues only".
 *   - Only PUBLISHED articles have search-index rows, so drafts are unfindable
 *     because there is nothing to find rather than because a query remembered
 *     to exclude them (research D4).
 *   - There is NO DELETE. Archiving is the removal (FR-007), and an archived
 *     article stays readable to its author.
 */

export interface ArticleView {
  id: number;
  slug: string | null;
  categoryId: number;
  categoryName: { en: string | null; ar: string | null };
  titleEn: string | null;
  titleAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
  /**
   * DERIVED, never stored, and the field FR-005a depends on.
   *
   * Every surface that lists or opens an article uses this to tell the reader
   * which language they are being handed. Under Clarifications Q3 a
   * one-language article is legitimate, and an unlabelled one looks like a page
   * that failed to load.
   */
  availableLanguages: Array<'en' | 'ar'>;
  status: KbArticleStatus;
  audience: KbAudience;
  publishedAt: Date | null;
  /** When the slug was fixed. The interface explains why the URL no longer matches the title. */
  slugLockedAt: Date | null;
  viewCount: number;
  updatedAt: Date;
  updatedBy: { id: number; fullName: string } | null;
  version: number;
}

/**
 * A language counts only when BOTH halves are present.
 *
 * The same rule Phase 4 applied to reply templates, and for the same reason: a
 * body with no title cannot be found, and a title with no body opens onto
 * nothing. Half an article is worse than no article, because the reader spends
 * their attention before discovering it.
 */
function availableLanguages(article: KbArticle): Array<'en' | 'ar'> {
  const languages: Array<'en' | 'ar'> = [];

  if (article.title_en && article.body_en) languages.push('en');
  if (article.title_ar && article.body_ar) languages.push('ar');

  return languages;
}

interface ArticleWithRelations extends KbArticle {
  category?: KbCategory;
  updatedBy?: User | null;
}

function toView(article: KbArticle): ArticleView {
  const withRelations = article as ArticleWithRelations;

  return {
    id: article.id,
    slug: article.slug,
    categoryId: article.category_id,
    categoryName: {
      en: withRelations.category?.name_en ?? null,
      ar: withRelations.category?.name_ar ?? null,
    },
    titleEn: article.title_en,
    titleAr: article.title_ar,
    bodyEn: article.body_en,
    bodyAr: article.body_ar,
    availableLanguages: availableLanguages(article),
    status: article.status,
    audience: article.audience,
    publishedAt: article.published_at,
    // The slug is fixed at first publish and never moves afterwards, so the
    // moment it was fixed IS the moment of first publish (research D10).
    slugLockedAt: article.slug ? article.published_at : null,
    viewCount: article.view_count,
    updatedAt: article.updated_at,
    updatedBy: withRelations.updatedBy
      ? { id: withRelations.updatedBy.id, fullName: withRelations.updatedBy.full_name }
      : null,
    version: article.version,
  };
}

const INCLUDES = [
  { model: KbCategory, as: 'category' },
  { model: User, as: 'updatedBy' },
];

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A URL-safe slug, derived once at first publish (research D10).
 *
 * Arabic characters are KEPT rather than transliterated. Transliterating is a
 * guess, and guessing across scripts produces confident nonsense — the same
 * argument the tokenizer makes for refusing to do it. A percent-encoded Arabic
 * slug is ugly in a status bar and correct everywhere else; a wrong Latin
 * approximation is neither.
 */
function slugify(title: string): string {
  const base = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['"]/g, '')
    // Anything that is not a letter, a number, or a mark becomes a separator.
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);

  return base.length > 0 ? base : 'article';
}

/**
 * The slug is UNIQUE and PERMANENT, so a collision is resolved once, here, and
 * never revisited. The suffix is the article's own id rather than a counter:
 * it needs no second query and cannot race another publish.
 */
async function uniqueSlug(title: string, articleId: number, transaction: Transaction) {
  const base = slugify(title);
  const taken = await KbArticle.findOne({ where: { slug: base }, transaction });

  return taken ? `${base}-${articleId}` : base;
}

// --- Reading --------------------------------------------------------------

export interface ListOptions {
  status?: unknown;
  categoryId?: unknown;
  audience?: unknown;
  q?: unknown;
  /** Stewardship sorting (FR-051). */
  sort?: unknown;
  page?: unknown;
  pageSize?: unknown;
}

const SORTS: Record<string, Array<[string, 'ASC' | 'DESC']>> = {
  // Default: what changed most recently, which is what an editor wants.
  updated: [['updated_at', 'DESC']],
  // FR-051: "old and unread" and "old and heavily read" are both findable, and
  // the second is the more urgent — a stale article nobody reads is a tidying
  // job; a stale article everybody reads is actively misinforming people.
  stale: [['updated_at', 'ASC']],
  mostRead: [['view_count', 'DESC']],
  leastRead: [['view_count', 'ASC']],
};

export async function list(options: ListOptions, actor: Actor): Promise<Paged<ArticleView>> {
  const pageSize = clampPageSize(options.pageSize);
  const pageNumber = Number(options.page);
  const page = Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.floor(pageNumber) : 1;

  const where: Record<string | symbol, unknown> = {};

  if (typeof options.status === 'string' && options.status !== '') {
    where.status = options.status;
  } else if (!(await mayAuthor(actor))) {
    // FR-053: reading published articles rides on being signed in. Someone
    // without kb:author never sees a draft, so the unfiltered list is the
    // published-and-archived one rather than everything.
    where.status = { [Op.ne]: 'draft' };
  }

  if (typeof options.audience === 'string' && options.audience !== '') {
    where.audience = options.audience;
  }

  const categoryId = Number(options.categoryId);
  if (Number.isInteger(categoryId) && categoryId > 0) where.category_id = categoryId;

  const term = typeof options.q === 'string' ? options.q.trim() : '';

  if (term) {
    // A management-screen filter, NOT the search this phase built (FR-017).
    // An editor hunting for "the one about refunds" in a list of forty is doing
    // something different from a reader searching the corpus, and using the
    // ranked index here would reorder the list they are trying to scan.
    where[Op.or as unknown as string] = [
      { title_en: { [Op.like]: `%${term}%` } },
      { title_ar: { [Op.like]: `%${term}%` } },
    ];
  }

  const sortKey = typeof options.sort === 'string' ? options.sort : 'updated';
  const order = SORTS[sortKey] ?? SORTS.updated!;

  const { rows, count } = await KbArticle.findAndCountAll({
    where,
    include: INCLUDES,
    // A TOTAL ordering, always. `id` breaks every tie, so two readers of the
    // same list see the same list — the property SC-008 asserts for search and
    // that a management screen needs just as much when paging.
    order: [...order, ['id', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  return { items: rows.map(toView), page, pageSize, total: count };
}

async function mayAuthor(actor: Actor): Promise<boolean> {
  return authorizationService.roleHasPermission(actor.roleId, 'kb:author');
}

/**
 * One article.
 *
 * A DRAFT IS 404, NOT 403, for anyone without `kb:author`. Deciding permission
 * before existence is what stops the status code disclosing that a draft is
 * being written — the rule FR-019 fixed in Phase 1 and every phase since has
 * followed.
 */
export async function get(id: number, actor: Actor): Promise<ArticleView> {
  const article = await KbArticle.findByPk(id, { include: INCLUDES });

  if (!article) throw notFound();

  if (article.status === 'draft' && !(await mayAuthor(actor))) throw notFound();

  return toView(article);
}

// --- Writing --------------------------------------------------------------

export interface ArticleInput {
  categoryId?: unknown;
  titleEn?: unknown;
  titleAr?: unknown;
  bodyEn?: unknown;
  bodyAr?: unknown;
  audience?: unknown;
  version?: unknown;
}

function auditLabel(article: KbArticle): string {
  return article.title_en ?? article.title_ar ?? String(article.id);
}

async function requireCategory(categoryId: unknown): Promise<KbCategory> {
  const id = Number(categoryId);

  if (!Number.isInteger(id) || id < 1) {
    // FR-010: filing is mandatory rather than encouraged. An article only
    // search can reach is one nobody can browse to.
    throw validationError([{ field: 'categoryId', message: 'kb.error.categoryRequired' }]);
  }

  const category = await KbCategory.findByPk(id);

  if (!category) {
    throw validationError([{ field: 'categoryId', message: 'kb.error.categoryUnknown' }]);
  }

  return category;
}

function readAudience(value: unknown, fallback: KbAudience): KbAudience {
  if (value === undefined || value === null) return fallback;

  if (!KB_AUDIENCES.includes(value as KbAudience)) {
    throw validationError([{ field: 'audience', message: 'kb.error.audienceInvalid' }]);
  }

  return value as KbAudience;
}

/**
 * ALWAYS A DRAFT, ALWAYS INTERNAL BY DEFAULT (FR-004, FR-031).
 *
 * `status` is not a parameter here and must never become one. An article is
 * visible because somebody published it, not because the thing that created it
 * asked for that — which is what makes the publish gate a gate.
 */
export async function create(
  input: ArticleInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<ArticleView> {
  const category = await requireCategory(input.categoryId);

  const article = await sequelize.transaction(async (transaction) => {
    const created = await KbArticle.create(
      {
        category_id: category.id,
        title_en: text(input.titleEn),
        title_ar: text(input.titleAr),
        body_en: text(input.bodyEn),
        body_ar: text(input.bodyAr),
        audience: readAudience(input.audience, 'internal'),
        created_by_user_id: actor.id,
        updated_by_user_id: actor.id,
      },
      { transaction },
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_ARTICLE_CREATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_article',
        targetId: created.id,
        targetLabel: auditLabel(created),
        newValue: { categoryId: category.id, status: created.status },
        ...context,
      },
      transaction,
    );

    return created;
  });

  return get(article.id, actor);
}

/**
 * Edit.
 *
 * A PUBLISHED ARTICLE IS REINDEXED IN THE SAME TRANSACTION as the text change
 * (research D4). "Saved but not searchable" and "searchable under its old text"
 * are both unrepresentable, which is the only way to make an index that cannot
 * disagree with its article — and a disagreement here would be silent.
 *
 * The slug is NOT touched, deliberately (research D10). Correcting a typo in a
 * title must not break every link already sent.
 */
export async function update(
  id: number,
  input: ArticleInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<ArticleView> {
  const article = await KbArticle.findByPk(id);

  if (!article) throw notFound();

  // Optimistic locking, per the Phase 2 precedent. Two editors on one article
  // is exactly the collision this content invites — the second save would
  // silently discard the first.
  const version = Number(input.version);
  if (!Number.isInteger(version) || version !== article.version) throw staleRecord();

  const category =
    input.categoryId === undefined
      ? await KbCategory.findByPk(article.category_id)
      : await requireCategory(input.categoryId);

  const previous = {
    titleEn: article.title_en,
    titleAr: article.title_ar,
    audience: article.audience,
    categoryId: article.category_id,
  };

  await sequelize.transaction(async (transaction) => {
    if (input.titleEn !== undefined) article.title_en = text(input.titleEn);
    if (input.titleAr !== undefined) article.title_ar = text(input.titleAr);
    if (input.bodyEn !== undefined) article.body_en = text(input.bodyEn);
    if (input.bodyAr !== undefined) article.body_ar = text(input.bodyAr);
    if (input.audience !== undefined)
      article.audience = readAudience(input.audience, article.audience);
    if (category) article.category_id = category.id;

    article.updated_by_user_id = actor.id;
    article.version += 1;

    await article.save({ transaction });

    // In the SAME transaction. See the note above: this is the whole of why
    // "searchable under its old text" cannot happen.
    await searchService.reindex(article.id, transaction);

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_ARTICLE_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_article',
        targetId: article.id,
        targetLabel: auditLabel(article),
        previousValue: previous,
        newValue: {
          titleEn: article.title_en,
          titleAr: article.title_ar,
          audience: article.audience,
          categoryId: article.category_id,
        },
        ...context,
      },
      transaction,
    );
  });

  return get(article.id, actor);
}

// --- The lifecycle --------------------------------------------------------

/**
 * FR-005: a full pair — title AND body in the same language — must exist.
 *
 * The message says WHICH half is missing, because "this article is invalid" is
 * not something anybody can act on. Under Clarifications Q3 a one-language
 * article is entirely legitimate, so the rule is "at least one complete pair",
 * never "both languages".
 */
function assertPublishable(article: KbArticle): void {
  const english = Boolean(article.title_en && article.body_en);
  const arabic = Boolean(article.title_ar && article.body_ar);

  if (english || arabic) return;

  const details: ErrorDetail[] = [];

  if (article.title_en && !article.body_en) {
    details.push({ field: 'bodyEn', message: 'kb.error.incompletePair' });
  }
  if (article.body_en && !article.title_en) {
    details.push({ field: 'titleEn', message: 'kb.error.incompletePair' });
  }
  if (article.title_ar && !article.body_ar) {
    details.push({ field: 'bodyAr', message: 'kb.error.incompletePair' });
  }
  if (article.body_ar && !article.title_ar) {
    details.push({ field: 'titleAr', message: 'kb.error.incompletePair' });
  }

  // Nothing at all was written. A different message, because "finish the
  // Arabic body" would be nonsense advice for an empty article.
  if (details.length === 0) {
    details.push({ field: 'titleEn', message: 'kb.error.noCompleteLanguage' });
  }

  throw articleIncomplete(details);
}

/**
 * Publish (FR-006).
 *
 * `published_at` is set ONCE and never cleared, including by archiving. "When
 * did this first go live" stays true through an archive and a restore, which is
 * the question a stewardship review actually asks.
 *
 * The slug is derived HERE, at first publish, and never again (research D10).
 * A draft has no public URL, and inventing one before anybody decides to
 * publish would reserve a name for a document that may never exist.
 */
export async function publish(
  id: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<ArticleView> {
  const article = await KbArticle.findByPk(id);

  if (!article) throw notFound();

  assertPublishable(article);

  await sequelize.transaction(async (transaction) => {
    if (!article.slug) {
      const title = article.title_en ?? article.title_ar ?? '';
      article.slug = await uniqueSlug(title, article.id, transaction);
    }

    if (!article.published_at) {
      article.published_at = now();
      article.published_by_user_id = actor.id;
    }

    article.status = 'published';
    article.updated_by_user_id = actor.id;
    article.version += 1;

    await article.save({ transaction });

    // Index rows exist for published articles and no others (research D4).
    await searchService.reindex(article.id, transaction);

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_ARTICLE_PUBLISHED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_article',
        targetId: article.id,
        targetLabel: auditLabel(article),
        newValue: { slug: article.slug, audience: article.audience },
        ...context,
      },
      transaction,
    );
  });

  return get(article.id, actor);
}

/**
 * Archive (FR-007). THIS IS THE PROJECT'S DELETE, and it destroys nothing.
 *
 * The article leaves every reader surface — search, browse, suggestion, the
 * public help centre — because its index rows go, not because four queries each
 * remembered to exclude it. It stays readable to its author, and it comes back
 * with `restore`.
 *
 * A DRAFT MAY BE ARCHIVED TOO (FR-003). An abandoned draft is exactly the thing
 * an author wants out of their list, and refusing would leave the only way to
 * tidy up being to leave it there forever.
 */
export async function archive(
  id: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<ArticleView> {
  const article = await KbArticle.findByPk(id);

  if (!article) throw notFound();

  if (article.status !== 'archived') {
    await sequelize.transaction(async (transaction) => {
      article.status = 'archived';
      article.updated_by_user_id = actor.id;
      article.version += 1;

      await article.save({ transaction });

      // Removes the index rows. Note that `published_at` is untouched.
      await searchService.reindex(article.id, transaction);

      await auditService.record(
        {
          action: auditService.AUDIT_ACTIONS.KB_ARTICLE_ARCHIVED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'kb_article',
          targetId: article.id,
          targetLabel: auditLabel(article),
          newValue: { status: 'archived' },
          ...context,
        },
        transaction,
      );
    });
  }

  return get(article.id, actor);
}

/**
 * Restore an archived article to published.
 *
 * It is re-validated on the way back: an article edited into an incomplete
 * state while archived must not slip past the gate simply because it was once
 * published.
 */
export async function restore(
  id: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<ArticleView> {
  const article = await KbArticle.findByPk(id);

  if (!article) throw notFound();

  if (article.status !== 'archived') {
    throw validationError([{ field: 'status', message: 'kb.error.notArchived' }]);
  }

  assertPublishable(article);

  await sequelize.transaction(async (transaction) => {
    article.status = 'published';
    article.updated_by_user_id = actor.id;
    article.version += 1;

    if (!article.slug) {
      const title = article.title_en ?? article.title_ar ?? '';
      article.slug = await uniqueSlug(title, article.id, transaction);
    }

    // Restoring a never-published draft-then-archived article makes it live for
    // the first time, so the first-publish moment is recorded now.
    if (!article.published_at) {
      article.published_at = now();
      article.published_by_user_id = actor.id;
    }

    await article.save({ transaction });
    await searchService.reindex(article.id, transaction);

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_ARTICLE_RESTORED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_article',
        targetId: article.id,
        targetLabel: auditLabel(article),
        newValue: { status: 'published' },
        ...context,
      },
      transaction,
    );
  });

  return get(article.id, actor);
}

/**
 * THERE IS NO `remove`, AND THERE MUST NOT BE ONE.
 *
 * FR-007 makes archiving the removal. The same reasoning that gave customers
 * deactivation, tickets a merge, and templates retirement: a link somebody sent
 * a customer last month should not lead to a hole, and an article somebody
 * deleted in error should be recoverable by the person who noticed.
 *
 * The absent route and the absent interface control are the visible half of
 * this; `kb.articles.noDeleteReason` on the archive control is where a reader
 * finds out why.
 */

// --- Readership (User Story 6, FR-049, FR-050, research D11) --------------

/**
 * A COUNTER, NEVER AN EVENT TABLE.
 *
 * FR-050 forbids storing anything identifying a reader, and this is how that is
 * made structural rather than promised. A counter has nowhere to put an IP
 * address. An event table has a column free the first time somebody wants a
 * trend, and adding it would be a one-line change nobody would think to
 * question. Phase 10 owns trends and can design its own thing, deliberately.
 *
 * An atomic increment, so two simultaneous readers do not lose a count between
 * a read and a write — and so it never touches `updated_at`, which the
 * stewardship view reads as "when did somebody last CHANGE this" (FR-048).
 * Reading an article is not editing it, and a counter that bumped the timestamp
 * would make every popular article look freshly maintained.
 */
export async function recordView(articleId: number): Promise<void> {
  await KbArticle.increment('view_count', { where: { id: articleId }, silent: true });
}

/**
 * The PUBLIC read path's increment: best-effort, and off the response path.
 *
 * AN UNAUTHENTICATED GET THAT WRITES ON EVERY VIEW IS A DENIAL-OF-SERVICE
 * AMPLIFIER AIMED AT THE ONE SURFACE STRANGERS CAN REACH. Every anonymous
 * request to `/api/public/kb/articles/:slug` would otherwise become a row lock
 * and a write, and a few thousand requests a second against one popular article
 * would serialise on that row while the rest of the application waited behind
 * it for a connection.
 *
 * So the public path does not await this and does not fail on it. THE TRADE IS
 * DELIBERATE AND IT IS THE RIGHT WAY ROUND: a dropped count is a statistic
 * being slightly wrong; a saturated connection pool is an outage. FR-049 asks
 * how often an article is read, which is a question about magnitude — nobody
 * makes a stewardship decision on the difference between 4,100 and 4,097.
 *
 * The rate limit on the public route is the first defence; this is the second,
 * and it is the one that holds when the first is set too generously.
 */
export function recordPublicView(articleId: number): void {
  void recordView(articleId).catch(() => {
    // Deliberately swallowed. A reader must never see an error, or lose their
    // article, because a counter could not be written.
  });
}
