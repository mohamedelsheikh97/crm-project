import { request } from './http';

/**
 * AI administration (Phase 9, US6).
 *
 * NOTHING HERE CARRIES A SECRET OR A PROCESSING LOCATION (FR-064, research D2).
 * The types below are the whole of what the server will return, and the absence
 * of a `location` field is deliberate: it is not configurable, and a read-only
 * one would invite a PATCH for it.
 */
export interface AiConfig {
  enabled: boolean;
  features: { summary: boolean; draft: boolean; classify: boolean; similar: boolean; assistant: boolean };
  ceilings: { summary: number; draft: number; classify: number; assistant: number };
  assistantLangs: Array<'ar' | 'en'>;
  groundingFloor: number;
}

export interface AiInvocationRow {
  id: number;
  feature: string;
  subjectType: string;
  subjectId: number | null;
  requestedBy: number | null;
  portalAccountId: number | null;
  location: string;
  outcome: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  errorCode: string | null;
  at: string;
}

export interface ConversationRow {
  id: number;
  portalAccountId: number | null;
  anonymous: boolean;
  lang: 'ar' | 'en';
  ticketId: number | null;
  escalatedAt: string | null;
  lastActivityAt: string;
}

export interface ConversationDetail {
  id: number;
  lang: 'ar' | 'en';
  ticketId: number | null;
  escalatedAt: string | null;
  turns: Array<{
    role: 'customer' | 'assistant';
    body: string;
    citedArticleIds: number[] | null;
    at: string;
  }>;
}

export function config(): Promise<AiConfig> {
  return request<AiConfig>('/admin/ai/config');
}

export function updateConfig(patch: Partial<AiConfig>): Promise<AiConfig> {
  return request<AiConfig>('/admin/ai/config', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function activity(
  page = 1,
): Promise<{ items: AiInvocationRow[]; total: number; page: number; pageSize: number; contentRetained: boolean }> {
  return request(`/admin/ai/activity?page=${page}`);
}

export function conversations(
  page = 1,
): Promise<{ items: ConversationRow[]; total: number; page: number; pageSize: number }> {
  return request(`/admin/ai/conversations?page=${page}`);
}

export function conversation(id: number): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/admin/ai/conversations/${id}`);
}
