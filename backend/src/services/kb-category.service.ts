import { QueryTypes, type Transaction } from 'sequelize';

import { sequelize } from '../config/database.js';
import {
  categoryInUse,
  notFound,
  staleRecord,
  validationError,
} from '../errors/app-error.js';
import { KbArticle, KbCategory, KbGuide, KbGuideStep } from '../models/index.js';
import { isTicketCategory } from '../tickets/taxonomy.js';
import * as auditService from './audit.service.js';
import type { UserActor as Actor, AuditContext } from './ticket.service.js';

/**
 * Categories and guides — the SHAPE of the knowledge base rather than its
 * content (Phase 7, User Story 5).
 *
 * READING is here from User Story 2 onwards, because filing is mandatory
 * (FR-010) and an article editor that cannot offer the categories cannot file
 * anything. MANAGEMENT — create, edit, reorder, delete, and the whole of guides
 * — arrives with User Story 5, gated `kb:manage`.
 *
 * Names are stored PER LANGUAGE rather than as i18n keys (FR-012), because an
 * administrator creates these at runtime and cannot add a key to a locale file.
 */

export interface CategoryView {
  id: number;
  nameEn: string | null;
  nameAr: string | null;
  slug: string;
  /**
   * The stated KB-to-ticket relationship FR-040 requires (research D6).
   *
   * Null means "relates to no particular ticket category", which is the honest
   * answer for something like "Getting started". A BOOST when suggesting, never
   * a filter — a technical article can be the right answer to a billing ticket.
   */
  ticketCategory: string | null;
  position: number;
  /** How many articles stand in the way of deleting it (FR-015). */
  articleCount: number;
  /** How many of those a reader can actually reach. */
  publishedCount: number;
  version: number;
}

interface CountedRow {
  id: number;
  name_en: string | null;
  name_ar: string | null;
  slug: string;
  ticket_category: string | null;
  position: number;
  version: number;
  article_count: number | string;
  published_count: number | string;
}

/**
 * Every category in `position` order, with its article counts.
 *
 * BOTH COUNTS, deliberately. The total is what FR-015's delete refusal needs;
 * the published one is what a browse surface needs to know whether a category
 * has anything in it for a reader (FR-014). Collapsing them to one number makes
 * one of those two questions unanswerable.
 */
export async function list(): Promise<CategoryView[]> {
  const rows = await sequelize.query<CountedRow>(
    `SELECT c.id, c.name_en, c.name_ar, c.slug, c.ticket_category, c.position, c.version,
            COUNT(a.id) AS article_count,
            SUM(CASE WHEN a.status = 'published' THEN 1 ELSE 0 END) AS published_count
       FROM kb_categories c
       LEFT JOIN kb_articles a ON a.category_id = c.id
      GROUP BY c.id
      -- A TOTAL ordering. Browse order is an editorial decision, and the id
      -- breaks the tie so two readers never see two different orders.
      ORDER BY c.position ASC, c.id ASC`,
    { type: QueryTypes.SELECT },
  );

  return rows.map((row) => ({
    id: row.id,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    slug: row.slug,
    ticketCategory: row.ticket_category,
    position: row.position,
    articleCount: Number(row.article_count),
    publishedCount: Number(row.published_count ?? 0),
    version: row.version,
  }));
}

export async function findBySlug(slug: string): Promise<KbCategory | null> {
  return KbCategory.findOne({ where: { slug } });
}

// --- Management (User Story 5, kb:manage) ---------------------------------

export interface CategoryInput {
  nameEn?: unknown;
  nameAr?: unknown;
  ticketCategory?: unknown;
  position?: unknown;
  version?: unknown;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A slug from whichever name exists.
 *
 * Arabic characters are kept rather than transliterated, for the reason
 * articles keep theirs: transliterating is a guess, and guessing across scripts
 * produces confident nonsense.
 */
function slugify(name: string): string {
  const base = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  return base.length > 0 ? base : 'category';
}

/**
 * At least one name, in one language.
 *
 * A category with no name is a heading nobody can read. Both are accepted
 * because Clarifications Q3's rule for articles applies here too: an
 * organisation working in one language should not be forced to invent the other.
 */
function assertNamed(nameEn: string | null, nameAr: string | null): void {
  if (nameEn || nameAr) return;

  throw validationError([{ field: 'nameEn', message: 'kb.error.categoryNameRequired' }]);
}

/**
 * `ticket_category` is validated against Phase 3's fixed list rather than
 * stored as an ENUM (research D6).
 *
 * That keeps adding a ticket category in a later phase from needing a migration
 * here — the relationship is data about a set that lives somewhere else.
 */
function readTicketCategory(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;

  if (!isTicketCategory(value)) {
    throw validationError([{ field: 'ticketCategory', message: 'kb.error.ticketCategoryUnknown' }]);
  }

  return value;
}

export async function createCategory(
  input: CategoryInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<CategoryView> {
  const nameEn = text(input.nameEn);
  const nameAr = text(input.nameAr);

  assertNamed(nameEn, nameAr);

  const position = Number(input.position);
  let createdId = 0;

  await sequelize.transaction(async (transaction) => {
    const created = await KbCategory.create(
      {
        name_en: nameEn,
        name_ar: nameAr,
        slug: await uniqueCategorySlug(slugify((nameEn ?? nameAr)!), transaction),
        ticket_category: readTicketCategory(input.ticketCategory),
        position: Number.isInteger(position) && position >= 0 ? position : 0,
      },
      { transaction },
    );

    createdId = created.id;

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_CATEGORY_CHANGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_category',
        targetId: created.id,
        targetLabel: nameEn ?? nameAr ?? created.slug,
        newValue: { created: true, ticketCategory: created.ticket_category },
        ...context,
      },
      transaction,
    );
  });

  return (await list()).find((category) => category.id === createdId)!;
}

async function uniqueCategorySlug(base: string, transaction: Transaction): Promise<string> {
  let candidate = base;
  let suffix = 1;

  // A category slug is not permanent the way an article's is — no link has been
  // sent to it before it exists — so a plain counter is enough here.
  while (await KbCategory.findOne({ where: { slug: candidate }, transaction })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

export async function updateCategory(
  id: number,
  input: CategoryInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<CategoryView> {
  const category = await KbCategory.findByPk(id);

  if (!category) throw notFound();

  const version = Number(input.version);
  if (!Number.isInteger(version) || version !== category.version) throw staleRecord();

  const nameEn = input.nameEn === undefined ? category.name_en : text(input.nameEn);
  const nameAr = input.nameAr === undefined ? category.name_ar : text(input.nameAr);

  assertNamed(nameEn, nameAr);

  const previous = {
    nameEn: category.name_en,
    nameAr: category.name_ar,
    ticketCategory: category.ticket_category,
    position: category.position,
  };

  await sequelize.transaction(async (transaction) => {
    category.name_en = nameEn;
    category.name_ar = nameAr;

    if (input.ticketCategory !== undefined) {
      category.ticket_category = readTicketCategory(input.ticketCategory);
    }

    if (input.position !== undefined) {
      const position = Number(input.position);
      if (Number.isInteger(position) && position >= 0) category.position = position;
    }

    // THE SLUG IS NOT REDERIVED FROM A RENAMED CATEGORY, for the reason an
    // article's is not: a public URL already exists, and renaming a heading
    // must not break it.
    category.version += 1;

    await category.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_CATEGORY_CHANGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_category',
        targetId: category.id,
        targetLabel: nameEn ?? nameAr ?? category.slug,
        previousValue: previous,
        newValue: {
          nameEn: category.name_en,
          nameAr: category.name_ar,
          ticketCategory: category.ticket_category,
          position: category.position,
        },
        ...context,
      },
      transaction,
    );
  });

  return (await list()).find((entry) => entry.id === id)!;
}

/**
 * FR-015: a category holding articles cannot be deleted.
 *
 * AND THE REFUSAL CARRIES THE COUNT. That is the difference between a refusal
 * and a dead end: an administrator told "you cannot delete this" learns
 * nothing, while one told "eleven articles are filed here" knows exactly what
 * to do next. The database enforces the same rule through a RESTRICT foreign
 * key, so this is the readable half of a guarantee rather than the guarantee
 * itself.
 */
export async function deleteCategory(
  id: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const category = await KbCategory.findByPk(id);

  if (!category) throw notFound();

  const articleCount = await KbArticle.count({ where: { category_id: id } });

  if (articleCount > 0) throw categoryInUse(articleCount);

  await sequelize.transaction(async (transaction) => {
    await category.destroy({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_CATEGORY_CHANGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_category',
        targetId: id,
        targetLabel: category.name_en ?? category.name_ar ?? category.slug,
        previousValue: { slug: category.slug },
        newValue: { deleted: true },
        ...context,
      },
      transaction,
    );
  });
}

// --- Guides (User Story 5, FR-011a to FR-011d) ----------------------------

/**
 * A guide is an ORDERED SERIES OF ARTICLES, not a container for them
 * (research D9).
 *
 * The article does not know it is in a guide, stays in its own category, and
 * may appear in several guides. That is FR-011b true by construction: nothing
 * has to remember to keep it browsable, because nothing moved it.
 */

export interface GuideStepView {
  articleId: number;
  position: number;
  titleEn: string | null;
  titleAr: string | null;
  slug: string | null;
  status: string;
}

export interface GuideView {
  id: number;
  titleEn: string | null;
  titleAr: string | null;
  slug: string;
  audience: string;
  position: number;
  steps: GuideStepView[];
  /**
   * FR-011d, DERIVED rather than stored.
   *
   * A guide is offered to a reader only when at least one of its steps is
   * published. A stored flag would go stale the moment a step was archived, and
   * nothing would notice — exactly the class of bug research D4 removed from
   * search by keeping unpublished articles out of the index entirely.
   */
  isReaderVisible: boolean;
}

interface GuideWithSteps extends KbGuide {
  steps?: Array<KbGuideStep & { article?: KbArticle }>;
}

function toGuideView(guide: KbGuide): GuideView {
  const steps = ((guide as GuideWithSteps).steps ?? [])
    .slice()
    // A TOTAL ordering: position, then article id. Two steps claiming one
    // position must still produce one order, not whichever the database
    // happened to return.
    .sort((a, b) => a.position - b.position || a.article_id - b.article_id);

  return {
    id: guide.id,
    titleEn: guide.title_en,
    titleAr: guide.title_ar,
    slug: guide.slug,
    audience: guide.audience,
    position: guide.position,
    steps: steps.map((step) => ({
      articleId: step.article_id,
      position: step.position,
      titleEn: step.article?.title_en ?? null,
      titleAr: step.article?.title_ar ?? null,
      slug: step.article?.slug ?? null,
      status: step.article?.status ?? 'draft',
    })),
    isReaderVisible: steps.some((step) => step.article?.status === 'published'),
  };
}

const GUIDE_INCLUDES = [{ association: 'steps', include: [{ association: 'article' }] }];

export async function listGuides(): Promise<GuideView[]> {
  const guides = await KbGuide.findAll({
    include: GUIDE_INCLUDES,
    order: [
      ['position', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  return guides.map(toGuideView);
}

export interface GuideInput {
  titleEn?: unknown;
  titleAr?: unknown;
  audience?: unknown;
  position?: unknown;
  version?: unknown;
}

async function uniqueGuideSlug(base: string, transaction: Transaction): Promise<string> {
  let candidate = base;
  let suffix = 1;

  while (await KbGuide.findOne({ where: { slug: candidate }, transaction })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

export async function createGuide(
  input: GuideInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<GuideView> {
  const titleEn = text(input.titleEn);
  const titleAr = text(input.titleAr);

  if (!titleEn && !titleAr) {
    throw validationError([{ field: 'titleEn', message: 'kb.error.guideTitleRequired' }]);
  }

  const position = Number(input.position);
  let createdId = 0;

  await sequelize.transaction(async (transaction) => {
    const created = await KbGuide.create(
      {
        title_en: titleEn,
        title_ar: titleAr,
        slug: await uniqueGuideSlug(slugify((titleEn ?? titleAr)!), transaction),
        audience: input.audience === 'customer' ? 'customer' : 'internal',
        position: Number.isInteger(position) && position >= 0 ? position : 0,
      },
      { transaction },
    );

    createdId = created.id;

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_GUIDE_CHANGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_guide',
        targetId: created.id,
        targetLabel: titleEn ?? titleAr ?? created.slug,
        newValue: { created: true },
        ...context,
      },
      transaction,
    );
  });

  return (await listGuides()).find((guide) => guide.id === createdId)!;
}

export async function updateGuide(
  id: number,
  input: GuideInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<GuideView> {
  const guide = await KbGuide.findByPk(id);

  if (!guide) throw notFound();

  const version = Number(input.version);
  if (!Number.isInteger(version) || version !== guide.version) throw staleRecord();

  const titleEn = input.titleEn === undefined ? guide.title_en : text(input.titleEn);
  const titleAr = input.titleAr === undefined ? guide.title_ar : text(input.titleAr);

  if (!titleEn && !titleAr) {
    throw validationError([{ field: 'titleEn', message: 'kb.error.guideTitleRequired' }]);
  }

  await sequelize.transaction(async (transaction) => {
    guide.title_en = titleEn;
    guide.title_ar = titleAr;

    if (input.audience !== undefined) {
      guide.audience = input.audience === 'customer' ? 'customer' : 'internal';
    }

    if (input.position !== undefined) {
      const position = Number(input.position);
      if (Number.isInteger(position) && position >= 0) guide.position = position;
    }

    guide.version += 1;

    await guide.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_GUIDE_CHANGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_guide',
        targetId: guide.id,
        targetLabel: titleEn ?? titleAr ?? guide.slug,
        newValue: { titleEn, titleAr, audience: guide.audience },
        ...context,
      },
      transaction,
    );
  });

  return (await listGuides()).find((entry) => entry.id === id)!;
}

/**
 * REPLACE THE WHOLE ORDERED SEQUENCE, IN ONE TRANSACTION.
 *
 * A guide's order is ONE editorial decision, not a set of independent facts
 * about individual articles. A partial reorder — "move step 3 up", applied on
 * its own — leaves two steps claiming one position, and the reader gets an
 * order nobody chose.
 *
 * Replacing wholesale also makes removal free: an article absent from the new
 * sequence is out of the guide, and the article itself is untouched. It keeps
 * its category and every other guide it belongs to (research D9).
 */
export async function replaceGuideSteps(
  guideId: number,
  articleIds: unknown,
  actor: Actor,
  context: AuditContext = {},
): Promise<GuideView> {
  const guide = await KbGuide.findByPk(guideId);

  if (!guide) throw notFound();

  if (!Array.isArray(articleIds)) {
    throw validationError([{ field: 'articleIds', message: 'kb.error.stepsInvalid' }]);
  }

  const ids = articleIds.map(Number);

  if (ids.some((id) => !Number.isInteger(id) || id < 1)) {
    throw validationError([{ field: 'articleIds', message: 'kb.error.stepsInvalid' }]);
  }

  // An article appears at most once in a guide — the composite primary key says
  // so, and refusing here says WHY rather than surfacing a constraint violation.
  if (new Set(ids).size !== ids.length) {
    throw validationError([{ field: 'articleIds', message: 'kb.error.stepsDuplicate' }]);
  }

  const found = await KbArticle.count({ where: { id: ids } });

  if (found !== ids.length) {
    throw validationError([{ field: 'articleIds', message: 'kb.error.stepsUnknownArticle' }]);
  }

  await sequelize.transaction(async (transaction) => {
    await KbGuideStep.destroy({ where: { guide_id: guideId }, transaction });

    if (ids.length > 0) {
      await KbGuideStep.bulkCreate(
        ids.map((articleId, index) => ({
          guide_id: guideId,
          article_id: articleId,
          // 1-based, because the reader is told "Step 2 of 5" and a zeroth step
          // is a thing only a programmer would write.
          position: index + 1,
        })),
        { transaction },
      );
    }

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_GUIDE_CHANGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_guide',
        targetId: guideId,
        targetLabel: guide.title_en ?? guide.title_ar ?? guide.slug,
        newValue: { steps: ids },
        ...context,
      },
      transaction,
    );
  });

  return (await listGuides()).find((entry) => entry.id === guideId)!;
}

/**
 * Deleting a guide leaves EVERY ARTICLE IN IT UNTOUCHED.
 *
 * The cascade removes the join rows and nothing else — which is the whole
 * argument for modelling a guide as a join rather than a container (research
 * D9). Deleting a container would have to decide what happens to its contents,
 * and every answer to that question is wrong for somebody.
 */
export async function deleteGuide(
  id: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const guide = await KbGuide.findByPk(id);

  if (!guide) throw notFound();

  await sequelize.transaction(async (transaction) => {
    await guide.destroy({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.KB_GUIDE_CHANGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'kb_guide',
        targetId: id,
        targetLabel: guide.title_en ?? guide.title_ar ?? guide.slug,
        newValue: { deleted: true },
        ...context,
      },
      transaction,
    );
  });
}

/**
 * Where an article sits in a guide, for the reader's position line (FR-011c).
 *
 * Returned WITH the article rather than fetched separately, so "Step 2 of 5"
 * costs no extra request on the public surface — the reason the public article
 * payload carries a `guide` object at all.
 */
export async function guideContextFor(
  articleId: number,
): Promise<{ slug: string; position: number; total: number } | null> {
  const step = await KbGuideStep.findOne({
    where: { article_id: articleId },
    include: [{ association: 'guide' }],
    // An article may be in several guides (research D9). The lowest guide id
    // wins, deterministically, rather than whichever the database returns
    // first — a reader must not see their position change between page loads.
    order: [['guide_id', 'ASC']],
  });

  if (!step) return null;

  const guide = (step as KbGuideStep & { guide?: KbGuide }).guide;

  if (!guide) return null;

  const total = await KbGuideStep.count({ where: { guide_id: guide.id } });

  return { slug: guide.slug, position: step.position, total };
}
