import { http } from './http';

/**
 * The quick-reply library.
 *
 * In this phase a template is inserted into the internal note composer or
 * copied to the clipboard — nothing is sent to a customer, because no
 * customer-facing channel exists until Phase 5 (Clarifications Q2).
 */

export type TemplateLanguage = 'en' | 'ar';

export interface ReplyTemplate {
  id: number;
  titleEn: string | null;
  titleAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
  /**
   * Which languages this template can actually be inserted in.
   *
   * FR-070 depends on this: when a template exists in only one language, the
   * picker offers that version WITH ITS LANGUAGE IDENTIFIED rather than handing
   * an Arabic-speaking agent English text without saying so.
   */
  availableLanguages: TemplateLanguage[];
  retiredAt: string | null;
  createdAt: string;
}

export interface TemplatePage {
  items: ReplyTemplate[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TemplateInput {
  titleEn?: string | null;
  titleAr?: string | null;
  bodyEn?: string | null;
  bodyAr?: string | null;
}

export function fetchTemplates(
  query: { q?: string; includeRetired?: boolean; page?: number } = {},
): Promise<TemplatePage> {
  const params = new URLSearchParams();

  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.includeRetired) params.set('includeRetired', 'true');
  if (query.page) params.set('page', String(query.page));

  const search = params.toString();

  return http.get<TemplatePage>(`/templates${search === '' ? '' : `?${search}`}`);
}

export function createTemplate(input: TemplateInput): Promise<ReplyTemplate> {
  return http.post<ReplyTemplate>('/templates', input);
}

export function updateTemplate(id: number, input: TemplateInput): Promise<ReplyTemplate> {
  return http.patch<ReplyTemplate>(`/templates/${id}`, input);
}

/** Retirement, not deletion: text already written from it is untouched. */
export function retireTemplate(id: number): Promise<ReplyTemplate> {
  return http.post<ReplyTemplate>(`/templates/${id}/retire`);
}

/**
 * The version to insert for the active language.
 *
 * Returns the language actually used, so the interface can say so when it
 * differs from the one the agent is working in (FR-070).
 */
export function resolveTemplateBody(
  template: ReplyTemplate,
  preferred: TemplateLanguage,
): { body: string; language: TemplateLanguage } | null {
  if (template.availableLanguages.includes(preferred)) {
    const body = preferred === 'ar' ? template.bodyAr : template.bodyEn;
    if (body) return { body, language: preferred };
  }

  const fallback = template.availableLanguages[0];

  if (!fallback) return null;

  const body = fallback === 'ar' ? template.bodyAr : template.bodyEn;

  return body ? { body, language: fallback } : null;
}
