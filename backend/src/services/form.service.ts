import { notFound, validationError, type ErrorDetail } from '../errors/app-error.js';
import { FormDefinition } from '../models/index.js';
import {
  FORM_FIELD_TYPES,
  type FormFieldDefinition,
  type FormFieldType,
} from '../models/form-definition.model.js';
import { isTicketCategory, isTicketPriority } from '../tickets/taxonomy.js';

import * as auditService from './audit.service.js';

export interface Actor {
  id: number;
  email: string;
  fullName: string;
  roleId: number;
}

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface FormView {
  id: number;
  slug: string;
  titleEn: string;
  titleAr: string;
  fields: FormFieldDefinition[];
  defaultCategory: string | null;
  defaultPriority: string | null;
  isPublished: boolean;
}

/** What a VISITOR sees: one language, and nothing about how it is configured. */
export interface PublicFormView {
  slug: string;
  title: string;
  fields: Array<{ key: string; type: FormFieldType; required: boolean; label: string }>;
}

function toView(form: FormDefinition): FormView {
  return {
    id: form.id,
    slug: form.slug,
    titleEn: form.title_en,
    titleAr: form.title_ar,
    fields: form.fields_json,
    defaultCategory: form.default_category,
    defaultPriority: form.default_priority,
    isPublished: form.is_published,
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

/**
 * Validation is server-side and complete (FR-079, FR-083, FR-084).
 *
 * BOTH LANGUAGES ARE REQUIRED for the title and for every question. A form
 * asked in one language is unanswerable by half this project's customers, and
 * Principle I is not satisfied by an interface that is bilingual while the
 * questions it renders are not.
 */
function validate(input: Record<string, unknown>, details: ErrorDetail[]): FormFieldDefinition[] {
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';

  if (!SLUG.test(slug)) {
    details.push({ field: 'slug', message: 'forms.error.slugRequired' });
  }

  for (const [field, key] of [
    ['titleEn', 'forms.error.titleRequired'],
    ['titleAr', 'forms.error.titleRequired'],
  ] as const) {
    if (typeof input[field] !== 'string' || (input[field] as string).trim() === '') {
      details.push({ field, message: key });
    }
  }

  const rawFields = Array.isArray(input.fields) ? input.fields : [];

  if (rawFields.length === 0) {
    details.push({ field: 'fields', message: 'forms.error.fieldsRequired' });
  }

  const fields: FormFieldDefinition[] = [];
  const seen = new Set<string>();

  rawFields.forEach((raw, index) => {
    const entry = raw as Record<string, unknown>;
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';

    if (!FIELD_KEY.test(key) || seen.has(key)) {
      details.push({ field: `fields.${index}.key`, message: 'forms.error.fieldsRequired' });
      return;
    }

    seen.add(key);

    const type = FORM_FIELD_TYPES.includes(entry.type as FormFieldType)
      ? (entry.type as FormFieldType)
      : 'text';

    const labelEn = typeof entry.label_en === 'string' ? entry.label_en.trim() : '';
    const labelAr = typeof entry.label_ar === 'string' ? entry.label_ar.trim() : '';

    if (labelEn === '' || labelAr === '') {
      details.push({ field: `fields.${index}.label`, message: 'forms.error.labelRequired' });
      return;
    }

    fields.push({
      key,
      type,
      required: entry.required === true,
      label_en: labelEn,
      label_ar: labelAr,
    });
  });

  // FR-084: restricted to Phase 3's declared taxonomy, so a form cannot invent
  // a category the rest of the system does not know about.
  if (
    input.defaultCategory !== undefined &&
    input.defaultCategory !== null &&
    !isTicketCategory(input.defaultCategory)
  ) {
    details.push({ field: 'defaultCategory', message: 'forms.error.categoryInvalid' });
  }

  if (
    input.defaultPriority !== undefined &&
    input.defaultPriority !== null &&
    !isTicketPriority(input.defaultPriority)
  ) {
    details.push({ field: 'defaultPriority', message: 'forms.error.priorityInvalid' });
  }

  return fields;
}

export async function list(): Promise<{ items: FormView[] }> {
  const rows = await FormDefinition.findAll({ order: [['id', 'ASC']] });
  return { items: rows.map(toView) };
}

export async function create(
  input: Record<string, unknown>,
  actor: Actor,
  context: AuditContext = {},
): Promise<FormView> {
  const details: ErrorDetail[] = [];
  const fields = validate(input, details);

  if (details.length > 0) throw validationError(details);

  const slug = String(input.slug).trim().toLowerCase();

  if (await FormDefinition.findOne({ where: { slug } })) {
    throw validationError([{ field: 'slug', message: 'forms.error.slugTaken' }]);
  }

  const form = await FormDefinition.create({
    slug,
    title_en: String(input.titleEn).trim(),
    title_ar: String(input.titleAr).trim(),
    fields_json: fields,
    default_category: (input.defaultCategory as string | null) ?? null,
    default_priority: (input.defaultPriority as string | null) ?? null,
    is_published: input.isPublished === true,
    created_by_user_id: actor.id,
  });

  await auditService.recordAuthEvent({
    action: auditService.AUDIT_ACTIONS.FORM_CREATED,
    actorUserId: actor.id,
    actorEmail: actor.email,
    targetType: 'form',
    targetId: form.id,
    targetLabel: form.slug,
    metadata: { published: form.is_published },
    ...context,
  });

  return toView(form);
}

export async function update(
  id: number,
  input: Record<string, unknown>,
  actor: Actor,
  context: AuditContext = {},
): Promise<FormView> {
  const form = await FormDefinition.findByPk(id);

  if (!form) throw notFound();

  const details: ErrorDetail[] = [];
  const fields = validate({ ...input, slug: input.slug ?? form.slug }, details);

  if (details.length > 0) throw validationError(details);

  // NOTE: editing a definition cannot change what an existing ticket says. A
  // submission copies the question text as it was asked (FR-085), so old
  // tickets never refer back to this row.
  form.title_en = String(input.titleEn).trim();
  form.title_ar = String(input.titleAr).trim();
  form.fields_json = fields;
  form.default_category = (input.defaultCategory as string | null) ?? null;
  form.default_priority = (input.defaultPriority as string | null) ?? null;
  if (typeof input.isPublished === 'boolean') form.is_published = input.isPublished;

  await form.save();

  await auditService.recordAuthEvent({
    action: auditService.AUDIT_ACTIONS.FORM_UPDATED,
    actorUserId: actor.id,
    actorEmail: actor.email,
    targetType: 'form',
    targetId: form.id,
    targetLabel: form.slug,
    metadata: { published: form.is_published },
    ...context,
  });

  return toView(form);
}

/** The published form a visitor sees, in their language. */
export async function publicForm(slug: string, locale: string): Promise<PublicFormView> {
  const form = await FormDefinition.findOne({ where: { slug, is_published: true } });

  if (!form) throw notFound();

  const arabic = locale === 'ar';

  return {
    slug: form.slug,
    title: arabic ? form.title_ar : form.title_en,
    fields: form.fields_json.map((field) => ({
      key: field.key,
      type: field.type,
      required: field.required,
      label: arabic ? field.label_ar : field.label_en,
    })),
  };
}

export interface ValidatedSubmission {
  form: FormDefinition;
  /** Label text AS ASKED, paired with the answer — this is FR-085. */
  answers: Array<{ label: string; value: string }>;
  senderIdentity: string;
}

/**
 * Server-side validation of a submission (FR-083).
 *
 * The browser's `required` attribute is a convenience, not a control: anyone
 * can post directly. The failing field is named in the SUBMISSION'S language,
 * because the person reading the message chose that language.
 */
export async function validateSubmission(
  slug: string,
  body: Record<string, unknown>,
  locale: string,
): Promise<ValidatedSubmission> {
  const form = await FormDefinition.findOne({ where: { slug, is_published: true } });

  if (!form) throw notFound();

  const arabic = locale === 'ar';
  const answers: Array<{ label: string; value: string }> = [];
  const details: ErrorDetail[] = [];
  const submitted = (body.answers ?? {}) as Record<string, unknown>;

  for (const field of form.fields_json) {
    const raw = submitted[field.key];
    const value = typeof raw === 'string' ? raw.trim() : '';

    if (field.required && value === '') {
      details.push({ field: field.key, message: 'forms.public.required' });
      continue;
    }

    if (value !== '') {
      answers.push({ label: arabic ? field.label_ar : field.label_en, value });
    }
  }

  if (details.length > 0) throw validationError(details);

  // Identity comes from an email or phone field if the form asked for one.
  // A form that asks for neither produces a provisional customer named after
  // the submission, which is the honest outcome: we genuinely do not know who
  // sent it.
  const identityField = form.fields_json.find(
    (field) => field.type === 'email' || field.type === 'phone',
  );

  const senderIdentity =
    identityField && typeof submitted[identityField.key] === 'string'
      ? String(submitted[identityField.key]).trim()
      : '';

  return { form, answers, senderIdentity };
}
