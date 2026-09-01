import { http } from './http';

/**
 * The knowledge base (Phase 7).
 *
 * ARTICLE CONTENT IS DATA, NOT LOCALE KEYS. It is authored at runtime and
 * stored per language on the row (research D8), so it never enters the
 * `ar.json` / `en.json` mechanism that `frontend/tests/locales.test.ts` asserts
 * parity over. The same is true of category and guide names: an administrator
 * creating a category cannot add a key to a locale file (FR-012).
 *
 * Only INTERFACE text — labels, buttons, empty states, error messages — comes
 * from the locale files.
 */

export type KbLanguage = 'en' | 'ar';
export type KbArticleStatus = 'draft' | 'published' | 'archived';
export type KbAudience = 'internal' | 'customer';

export interface KbArticle {
  id: number;
  slug: string | null;
  categoryId: number;
  categoryName: { en: string | null; ar: string | null };
  titleEn: string | null;
  titleAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
  /**
   * What FR-005a depends on. Every surface that lists or opens an article uses
   * this to tell the reader which language they are being handed — under
   * Clarifications Q3 a one-language article is legitimate, and an unlabelled
   * one looks like a page that failed to load.
   */
  availableLanguages: KbLanguage[];
  status: KbArticleStatus;
  audience: KbAudience;
  publishedAt: string | null;
  slugLockedAt: string | null;
  viewCount: number;
  updatedAt: string;
  updatedBy: { id: number; fullName: string } | null;
  version: number;
}

export interface KbArticlePage {
  items: KbArticle[];
  page: number;
  pageSize: number;
  total: number;
}

export interface KbArticleInput {
  categoryId?: number;
  titleEn?: string | null;
  titleAr?: string | null;
  bodyEn?: string | null;
  bodyAr?: string | null;
  audience?: KbAudience;
  version?: number;
}

export type KbArticleSort = 'updated' | 'stale' | 'mostRead' | 'leastRead';

export function fetchArticles(
  query: {
    status?: KbArticleStatus | '';
    categoryId?: number;
    audience?: KbAudience | '';
    q?: string;
    sort?: KbArticleSort;
    page?: number;
  } = {},
): Promise<KbArticlePage> {
  const params = new URLSearchParams();

  if (query.status) params.set('status', query.status);
  if (query.categoryId) params.set('categoryId', String(query.categoryId));
  if (query.audience) params.set('audience', query.audience);
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.sort) params.set('sort', query.sort);
  if (query.page) params.set('page', String(query.page));

  const search = params.toString();

  return http.get<KbArticlePage>(`/knowledge/articles${search === '' ? '' : `?${search}`}`);
}

export function fetchArticle(id: number): Promise<KbArticle> {
  return http.get<KbArticle>(`/knowledge/articles/${id}`);
}

/** Always creates a DRAFT. `status` is not a field here, deliberately (FR-004). */
export function createArticle(input: KbArticleInput): Promise<KbArticle> {
  return http.post<KbArticle>('/knowledge/articles', input);
}

export function updateArticle(id: number, input: KbArticleInput): Promise<KbArticle> {
  return http.patch<KbArticle>(`/knowledge/articles/${id}`, input);
}

/**
 * A SEPARATE, DELIBERATE ACT from saving (FR-006).
 *
 * Publishing is the only quality gate this content has, and folding it into
 * save would remove the moment at which somebody decides.
 */
export function publishArticle(id: number): Promise<KbArticle> {
  return http.post<KbArticle>(`/knowledge/articles/${id}/publish`);
}

/** THE REMOVAL (FR-007). There is no delete, here or on the server. */
export function archiveArticle(id: number): Promise<KbArticle> {
  return http.post<KbArticle>(`/knowledge/articles/${id}/archive`);
}

export function restoreArticle(id: number): Promise<KbArticle> {
  return http.post<KbArticle>(`/knowledge/articles/${id}/restore`);
}

/**
 * Which languages an article would go live in, for the publish control to state
 * before anybody presses it.
 *
 * A publish control that does not say what it will do — which languages, and to
 * whom — asks somebody to make the only irreversible-feeling decision in this
 * phase without telling them what it is.
 */
export function publishSummary(article: KbArticle): {
  languages: KbLanguage[];
  audience: KbAudience;
  publishable: boolean;
} {
  return {
    languages: article.availableLanguages,
    audience: article.audience,
    publishable: article.availableLanguages.length > 0,
  };
}

// --- Categories -----------------------------------------------------------

export interface KbCategory {
  id: number;
  nameEn: string | null;
  nameAr: string | null;
  slug: string;
  /**
   * The stated relationship to a Phase 3 ticket category (research D6, FR-040).
   * Null means "relates to no particular one", which is the honest answer for
   * something like "Getting started". A boost when suggesting, never a filter.
   */
  ticketCategory: string | null;
  position: number;
  articleCount: number;
  publishedCount: number;
  version: number;
}

/**
 * Reading the structure needs no permission beyond being signed in: filing is
 * mandatory (FR-010), so every author needs this list. Changing it needs
 * `kb:manage`.
 */
export async function fetchCategories(): Promise<KbCategory[]> {
  return (await http.get<{ items: KbCategory[] }>('/knowledge/categories')).items;
}

// --- Search ---------------------------------------------------------------

export interface KbSearchHit {
  articleId: number;
  slug: string | null;
  title: string;
  /** Which language's content matched — always shown (FR-005a). */
  lang: KbLanguage;
  /** The fragment showing WHY it matched (FR-021). */
  excerpt: string;
  categoryId: number;
  categoryName: string | null;
  score: number;
}

export interface KbSearchResult {
  items: KbSearchHit[];
  /**
   * FR-029. Present only when the reader's own language found nothing and the
   * other one has matches. A COUNT, never the articles — the interface renders
   * it as an offer the reader chooses, never as results silently substituted.
   */
  otherLanguage: { lang: KbLanguage; count: number } | null;
}

/**
 * There is no `audience` parameter here, and there must not be one. The server
 * decides what a surface may reach (research D7).
 */
export function searchKnowledge(
  query: string,
  options: { lang?: KbLanguage; categoryId?: number; signal?: AbortSignal } = {},
): Promise<KbSearchResult> {
  const params = new URLSearchParams({ q: query });

  if (options.lang) params.set('lang', options.lang);
  if (options.categoryId) params.set('categoryId', String(options.categoryId));

  return http.get<KbSearchResult>(`/knowledge/search?${params.toString()}`, {
    signal: options.signal,
  });
}

// --- Suggestion -----------------------------------------------------------

export interface KbSuggestion extends KbSearchHit {
  /** True when somebody pinned this rather than the system computing it. */
  pinned: boolean;
  /** Null when an AUTOMATION RULE attached it — the Phase 5/6 convention. */
  attachedBy: { id: number; fullName: string } | null;
}

/**
 * ITS OWN REQUEST, never folded into the ticket payload (FR-045).
 *
 * The ticket is what the agent is waiting for. This fetches afterwards and
 * fills the panel in.
 */
export async function fetchSuggestions(ticketId: number): Promise<KbSuggestion[]> {
  return (await http.get<{ items: KbSuggestion[] }>(`/tickets/${ticketId}/suggestions`)).items;
}

// --- Structure management (User Story 5, kb:manage) ------------------------

export interface KbCategoryInput {
  nameEn?: string | null;
  nameAr?: string | null;
  ticketCategory?: string | null;
  position?: number;
  version?: number;
}

export function createCategory(input: KbCategoryInput): Promise<KbCategory> {
  return http.post<KbCategory>('/knowledge/categories', input);
}

export function updateCategory(id: number, input: KbCategoryInput): Promise<KbCategory> {
  return http.patch<KbCategory>(`/knowledge/categories/${id}`, input);
}

/**
 * Refused with a COUNT while the category still holds articles (FR-015).
 *
 * The caller reads `articleCount` from the error payload and tells the
 * administrator what stands in the way — a refusal that names the obstacle is a
 * different thing from a dead end.
 */
export function deleteCategory(id: number): Promise<void> {
  return http.delete<void>(`/knowledge/categories/${id}`);
}

export interface KbGuideStep {
  articleId: number;
  position: number;
  titleEn: string | null;
  titleAr: string | null;
  slug: string | null;
  status: KbArticleStatus;
}

export interface KbGuide {
  id: number;
  titleEn: string | null;
  titleAr: string | null;
  slug: string;
  audience: KbAudience;
  position: number;
  steps: KbGuideStep[];
  /**
   * FR-011d, DERIVED on the server from the steps rather than stored — a stored
   * flag would go stale the moment a step was archived.
   */
  isReaderVisible: boolean;
}

export async function fetchGuides(): Promise<KbGuide[]> {
  return (await http.get<{ items: KbGuide[] }>('/knowledge/guides')).items;
}

export interface KbGuideInput {
  titleEn?: string | null;
  titleAr?: string | null;
  audience?: KbAudience;
  position?: number;
  version?: number;
}

export function createGuide(input: KbGuideInput): Promise<KbGuide> {
  return http.post<KbGuide>('/knowledge/guides', input);
}

export function updateGuide(id: number, input: KbGuideInput): Promise<KbGuide> {
  return http.patch<KbGuide>(`/knowledge/guides/${id}`, input);
}

/**
 * PUT, and the WHOLE sequence.
 *
 * A guide's order is one editorial decision. Sending a single moved step would
 * let two steps claim one position, and the reader would get an order nobody
 * chose.
 */
export function replaceGuideSteps(id: number, articleIds: number[]): Promise<KbGuide> {
  return http.put<KbGuide>(`/knowledge/guides/${id}/steps`, { articleIds });
}

/** Deletes the guide. The articles in it are untouched (research D9). */
export function deleteGuide(id: number): Promise<void> {
  return http.delete<void>(`/knowledge/guides/${id}`);
}

/**
 * Move an item within an ordered list, returning a NEW array.
 *
 * Shared by the category list and the guide-step list because both are ordered
 * by an editorial decision and both must be reorderable FROM THE KEYBOARD — the
 * rule Phase 6's rule builder established for any list whose order is
 * functional. Drag-and-drop alone excludes anybody not using a mouse, and the
 * order here decides what a reader meets first.
 */
export function moveWithin<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);

  return next;
}

// --- The public help centre (User Story 4) --------------------------------

/**
 * A separate set of functions against `/public/kb`, and separate TYPES.
 *
 * NOT a reuse of the authenticated ones with a flag. The public payload is a
 * different, smaller shape — no ids, no author, no view count, no timestamps
 * (FR-035) — and giving the two one type would mean every consumer of the
 * public surface holding a type with optional fields it must remember never to
 * read. A smaller type is a smaller thing to get wrong.
 *
 * There is no `audience` parameter on any of these, and there must never be
 * one. The server decides what a surface may reach (research D7).
 */

export interface PublicCategory {
  slug: string;
  nameEn: string | null;
  nameAr: string | null;
  /**
   * The WHOLE browse tree arrives with the categories, rather than needing a
   * request per category. SC-007 needs every published article to be reachable
   * by browsing, and a customer on a phone should not pay a round-trip to
   * discover a category holds three articles.
   */
  articles: Array<{ slug: string; titleEn: string | null; titleAr: string | null }>;
}

export interface PublicArticle {
  slug: string;
  title: string;
  body: string;
  lang: KbLanguage;
  availableLanguages: KbLanguage[];
  category: { slug: string; name: string | null } | null;
  /** Present only when the article is part of one, with the reader's position. */
  guide: { slug: string; position: number; total: number } | null;
}

export interface PublicSearchHit {
  slug: string;
  title: string;
  lang: KbLanguage;
  excerpt: string;
  categoryName: string | null;
}

export interface PublicSearchResult {
  items: PublicSearchHit[];
  otherLanguage: { lang: KbLanguage; count: number } | null;
}

export async function fetchPublicCategories(): Promise<PublicCategory[]> {
  return (await http.get<{ items: PublicCategory[] }>('/public/kb/categories')).items;
}

export function fetchPublicArticle(slug: string, lang?: KbLanguage): Promise<PublicArticle> {
  const query = lang ? `?lang=${lang}` : '';

  return http.get<PublicArticle>(`/public/kb/articles/${encodeURIComponent(slug)}${query}`);
}

export function searchPublic(
  query: string,
  options: { lang?: KbLanguage; signal?: AbortSignal } = {},
): Promise<PublicSearchResult> {
  const params = new URLSearchParams({ q: query });
  if (options.lang) params.set('lang', options.lang);

  return http.get<PublicSearchResult>(`/public/kb/search?${params.toString()}`, {
    signal: options.signal,
  });
}

// --- Attachments (User Story 7) -------------------------------------------

/**
 * Pin an article to a ticket.
 *
 * Attaching one that is already attached is a NO-OP returning 200, not a
 * conflict — a double-click is not an error worth refusing, so the caller needs
 * no special handling for it.
 */
export function attachArticle(ticketId: number, articleId: number): Promise<unknown> {
  return http.post(`/tickets/${ticketId}/articles`, { articleId });
}

export function detachArticle(ticketId: number, articleId: number): Promise<void> {
  return http.delete<void>(`/tickets/${ticketId}/articles/${articleId}`);
}
