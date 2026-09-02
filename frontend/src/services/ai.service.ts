import { request } from './http';

/**
 * The STAFF-facing AI endpoints (Phase 9).
 *
 * Goes through `http.ts` — the staff client. The assistant has its own service
 * on the portal client, and the two never meet: Phase 8's realm separation
 * means a portal token must not reach these routes and a staff token must not
 * reach the assistant's.
 *
 * NOTHING HERE RETURNS AN ARTEFACT BY ID, because nothing is stored to have one
 * (research D7, FR-065b). A summary is computed on each request; regenerating
 * is calling the same endpoint again.
 */

export interface AiFeatureAvailability {
  summary: boolean;
  draft: boolean;
  classify: boolean;
  similar: boolean;
  assistant: boolean;
}

/** Read once per session; a disabled feature then costs nothing per ticket. */
export function features(): Promise<{ features: AiFeatureAvailability }> {
  return request<{ features: AiFeatureAvailability }>('/ai/features');
}

export interface CitedArticle {
  id: number;
  slug: string | null;
  title: string;
}

export interface TicketSummary {
  text: string;
  /**
   * The language the summary is WRITTEN IN — from the correspondence, not from
   * the reader's interface locale (FR-057, research D9). The panel renders
   * Arabic content inside English chrome when that is what the thread was.
   */
  contentLang: 'ar' | 'en';
  generatedAt: string;
  messageCount: number;
}

export interface ReplyDraft {
  text: string;
  contentLang: 'ar' | 'en';
  citedArticles: CitedArticle[];
}

export interface SimilarTicket {
  ticketId: number;
  reference: string;
  subject: string;
  resolvedAt: string | null;
  resolutionExcerpt: string | null;
  score: number;
}

export interface CategoryProposal {
  id: number;
  proposed: string;
  confidence: number | null;
  createdAt: string;
}

export function summary(ticketId: number, lang?: 'ar' | 'en'): Promise<TicketSummary> {
  const query = lang ? `?lang=${lang}` : '';
  return request<TicketSummary>(`/tickets/${ticketId}/ai/summary${query}`);
}

export function draft(ticketId: number): Promise<ReplyDraft> {
  return request<ReplyDraft>(`/tickets/${ticketId}/ai/draft`, { method: 'POST' });
}

export function similar(ticketId: number): Promise<{ items: SimilarTicket[] }> {
  return request<{ items: SimilarTicket[] }>(`/tickets/${ticketId}/similar`);
}

export function categoryProposal(ticketId: number): Promise<{ proposal: CategoryProposal | null }> {
  return request<{ proposal: CategoryProposal | null }>(
    `/tickets/${ticketId}/ai/category-proposal`,
  );
}

export function acceptProposal(ticketId: number): Promise<unknown> {
  return request(`/tickets/${ticketId}/ai/category-proposal/accept`, { method: 'POST' });
}

export function dismissProposal(ticketId: number): Promise<unknown> {
  return request(`/tickets/${ticketId}/ai/category-proposal/dismiss`, { method: 'POST' });
}
