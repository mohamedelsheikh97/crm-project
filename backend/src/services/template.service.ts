import { Op } from 'sequelize';

import { sequelize } from '../config/database.js';
import { now } from '../lib/clock.js';
import { notFound, templateLanguageRequired, type ErrorDetail } from '../errors/app-error.js';
import { ReplyTemplate } from '../models/index.js';
import * as auditService from './audit.service.js';
import type { Actor, AuditContext, Paged } from './ticket.service.js';
import { clampPageSize } from './ticket.service.js';

/**
 * The quick-reply library (Clarifications Q2).
 *
 * In this phase a template is inserted into the INTERNAL NOTE COMPOSER or
 * copied to the clipboard. Nothing is sent to a customer, because no
 * customer-facing correspondence exists until Phase 5. The library — its
 * content, its permissions, its bilingual bodies — is genuinely Phase 4 work
 * and is useful immediately, since an agent can paste a template into whatever
 * channel they are using today. Phase 5 adds channels as new insertion targets
 * and rebuilds none of this.
 */

export interface TemplateView {
  id: number;
  titleEn: string | null;
  titleAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
  /**
   * Which languages this template can actually be inserted in.
   *
   * This is what makes FR-070 implementable rather than aspirational: the
   * picker offers the version matching the active language, and when only one
   * exists it offers that one WITH ITS LANGUAGE IDENTIFIED rather than
   * silently substituting a language the agent did not choose.
   */
  availableLanguages: Array<'en' | 'ar'>;
  retiredAt: Date | null;
  createdAt: Date;
}

function availableLanguages(template: ReplyTemplate): Array<'en' | 'ar'> {
  const languages: Array<'en' | 'ar'> = [];

  // A language counts only when BOTH halves are present. A body with no title
  // cannot be found in the picker, and a title with no body inserts nothing.
  if (template.title_en && template.body_en) languages.push('en');
  if (template.title_ar && template.body_ar) languages.push('ar');

  return languages;
}

function toView(template: ReplyTemplate): TemplateView {
  return {
    id: template.id,
    titleEn: template.title_en,
    titleAr: template.title_ar,
    bodyEn: template.body_en,
    bodyAr: template.body_ar,
    availableLanguages: availableLanguages(template),
    retiredAt: template.retired_at,
    createdAt: template.created_at,
  };
}

export interface ListOptions {
  q?: string;
  /** Management screens ask for retired ones; the picker never does. */
  includeRetired?: boolean;
  page?: unknown;
  pageSize?: unknown;
}

export async function list(options: ListOptions = {}): Promise<Paged<TemplateView>> {
  const pageSize = clampPageSize(options.pageSize);
  const pageNumber = Number(options.page);
  const page = Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.floor(pageNumber) : 1;

  const where: Record<string | symbol, unknown> = {};

  // FR-071: a retired template leaves the picker. It is never deleted, so text
  // already written from it is untouched.
  if (!options.includeRetired) where.retired_at = null;

  const term = options.q?.trim();

  if (term) {
    // Title AND body, in EITHER language: an agent hunting for "the one about
    // refunds" is as likely to remember a phrase from the body as the title.
    // The collation makes this case- and accent-insensitive, so Arabic works
    // with no special handling.
    where[Op.or as unknown as string] = [
      { title_en: { [Op.like]: `%${term}%` } },
      { title_ar: { [Op.like]: `%${term}%` } },
      { body_en: { [Op.like]: `%${term}%` } },
      { body_ar: { [Op.like]: `%${term}%` } },
    ];
  }

  const { rows, count } = await ReplyTemplate.findAndCountAll({
    where,
    order: [['id', 'ASC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { items: rows.map(toView), page, pageSize, total: count };
}

export interface TemplateInput {
  titleEn?: unknown;
  titleAr?: unknown;
  bodyEn?: unknown;
  bodyAr?: unknown;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * At least one COMPLETE language pair.
 *
 * Validated here rather than as a schema CHECK so the message can say which
 * half is missing — "you gave an Arabic body with no Arabic title" is
 * actionable in a way a constraint violation is not.
 */
function assertOneCompleteLanguage(fields: {
  titleEn: string | null;
  titleAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
}): void {
  const english = Boolean(fields.titleEn && fields.bodyEn);
  const arabic = Boolean(fields.titleAr && fields.bodyAr);

  if (english || arabic) return;

  const details: ErrorDetail[] = [];

  if (fields.titleEn && !fields.bodyEn) {
    details.push({ field: 'bodyEn', message: 'template.error.bodyRequiredForTitle' });
  }

  if (fields.bodyEn && !fields.titleEn) {
    details.push({ field: 'titleEn', message: 'template.error.titleRequiredForBody' });
  }

  if (fields.titleAr && !fields.bodyAr) {
    details.push({ field: 'bodyAr', message: 'template.error.bodyRequiredForTitle' });
  }

  if (fields.bodyAr && !fields.titleAr) {
    details.push({ field: 'titleAr', message: 'template.error.titleRequiredForBody' });
  }

  if (details.length === 0) {
    details.push({ field: 'titleEn', message: 'template.error.oneLanguageRequired' });
  }

  throw templateLanguageRequired(details);
}

export async function create(
  input: TemplateInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<TemplateView> {
  const fields = {
    titleEn: text(input.titleEn),
    titleAr: text(input.titleAr),
    bodyEn: text(input.bodyEn),
    bodyAr: text(input.bodyAr),
  };

  assertOneCompleteLanguage(fields);

  const template = await sequelize.transaction(async (transaction) => {
    const created = await ReplyTemplate.create(
      {
        title_en: fields.titleEn,
        title_ar: fields.titleAr,
        body_en: fields.bodyEn,
        body_ar: fields.bodyAr,
        created_by_user_id: actor.id,
      },
      { transaction },
    );

    // Management IS audited (FR-077): changing the library changes what every
    // agent says to customers. Ordinary note, task, and notification activity
    // is not — flooding the log an investigator reads would make it useless.
    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.TEMPLATE_CREATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'reply_template',
        targetId: created.id,
        targetLabel: fields.titleEn ?? fields.titleAr ?? String(created.id),
        newValue: { created: true },
        ...context,
      },
      transaction,
    );

    return created;
  });

  return toView(template);
}

export async function update(
  id: number,
  input: TemplateInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<TemplateView> {
  const template = await ReplyTemplate.findByPk(id);

  if (!template) throw notFound();

  const fields = {
    titleEn: input.titleEn === undefined ? template.title_en : text(input.titleEn),
    titleAr: input.titleAr === undefined ? template.title_ar : text(input.titleAr),
    bodyEn: input.bodyEn === undefined ? template.body_en : text(input.bodyEn),
    bodyAr: input.bodyAr === undefined ? template.body_ar : text(input.bodyAr),
  };

  assertOneCompleteLanguage(fields);

  const previous = toView(template);

  await sequelize.transaction(async (transaction) => {
    template.title_en = fields.titleEn;
    template.title_ar = fields.titleAr;
    template.body_en = fields.bodyEn;
    template.body_ar = fields.bodyAr;

    await template.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.TEMPLATE_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'reply_template',
        targetId: template.id,
        targetLabel: fields.titleEn ?? fields.titleAr ?? String(template.id),
        previousValue: { titleEn: previous.titleEn, titleAr: previous.titleAr },
        newValue: { titleEn: fields.titleEn, titleAr: fields.titleAr },
        ...context,
      },
      transaction,
    );
  });

  return toView(template);
}

/**
 * Retirement, not deletion (FR-071).
 *
 * Consistent with everything else in this project: customers deactivate,
 * tickets merge, notes stay. A retired template leaves the picker and changes
 * nothing already written from it — the library never rewrites history.
 */
export async function retire(
  id: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<TemplateView> {
  const template = await ReplyTemplate.findByPk(id);

  if (!template) throw notFound();

  if (template.retired_at === null) {
    await sequelize.transaction(async (transaction) => {
      template.retired_at = now();
      await template.save({ transaction });

      await auditService.record(
        {
          action: auditService.AUDIT_ACTIONS.TEMPLATE_RETIRED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'reply_template',
          targetId: template.id,
          targetLabel: template.title_en ?? template.title_ar ?? String(template.id),
          newValue: { retired: true },
          ...context,
        },
        transaction,
      );
    });
  }

  return toView(template);
}
