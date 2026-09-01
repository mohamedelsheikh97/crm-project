import { portalPublicRequest, portalRequest, portalRequestBlob } from './portal-http';
import { usePortalStore } from '../stores/portal.store';

/**
 * Everything the portal calls (Phase 8).
 *
 * Centralised here because Constitution Principle III forbids components calling
 * `fetch` directly — and because this file is the front-end's inventory of the
 * portal surface, which is the same reason `portal/endpoints.ts` exists on the
 * server.
 */

export type CustomerState = 'received' | 'in_progress' | 'awaiting_you' | 'resolved' | 'closed';

export interface PortalTicketSummary {
  reference: string;
  subject: string;
  state: CustomerState;
  isSettled: boolean;
  raisedAt: string;
  lastChangedAt: string;
}

export interface PortalAttachment {
  id: number;
  fileName: string;
  contentType: string;
  byteSize: number;
}

export interface PortalMessage {
  direction: 'inbound' | 'outbound';
  channel: string;
  occurredAt: string;
  body: string;
  attachments: PortalAttachment[];
}

export interface PortalTicket {
  reference: string;
  subject: string;
  description: string | null;
  state: CustomerState;
  isSettled: boolean;
  raisedAt: string;
  lastChangedAt: string;
  category: string;
  priority: string;
  ratingOffered: boolean;
  replyOffered: boolean;
  satisfaction: { score: number; comment: string | null; submittedAt: string } | null;
  messages: PortalMessage[];
}

interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  customer: { email: string; language: 'ar' | 'en' | null };
}

/** Stores the session in one place, so no caller has to remember to. */
function adopt(response: SessionResponse): void {
  usePortalStore().setSession(response.accessToken, response.customer);
}

export async function login(email: string, password: string): Promise<void> {
  adopt(
    await portalPublicRequest<SessionResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  );
}

export async function logout(): Promise<void> {
  try {
    await portalPublicRequest<void>('/auth/logout', { method: 'POST' });
  } finally {
    // Cleared even if the call failed. Logout must always leave the browser in
    // the signed-out state — the alternative is a customer who pressed sign out
    // and is still signed in.
    usePortalStore().clear();
  }
}

export interface InvitationView {
  organisationName: string;
  email: string;
  purpose: 'invitation' | 'password_reset';
}

export function viewInvitation(token: string): Promise<InvitationView> {
  return portalPublicRequest<InvitationView>(`/invitations/${encodeURIComponent(token)}`);
}

export async function acceptInvitation(
  token: string,
  password: string,
  language: 'ar' | 'en',
): Promise<void> {
  adopt(
    await portalPublicRequest<SessionResponse>(`/invitations/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ password, language }),
    }),
  );
}

export function requestPasswordReset(email: string): Promise<void> {
  return portalPublicRequest<void>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function completePasswordReset(token: string, password: string): Promise<void> {
  return portalPublicRequest<void>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export interface PortalTicketPage {
  items: PortalTicketSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export function listRequests(): Promise<PortalTicketPage> {
  return portalRequest<PortalTicketPage>('/tickets');
}

export function getRequest(reference: string): Promise<PortalTicket> {
  return portalRequest<PortalTicket>(`/tickets/${encodeURIComponent(reference)}`);
}

export interface NewRequestInput {
  subject: string;
  description: string;
  category?: string;
  priority?: string;
}

export function raiseRequest(input: NewRequestInput): Promise<{ reference: string }> {
  return portalRequest<{ reference: string }>('/tickets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function reply(reference: string, body: string): Promise<{ reopened: boolean }> {
  return portalRequest<{ reference: string; reopened: boolean }>(
    `/tickets/${encodeURIComponent(reference)}/replies`,
    { method: 'POST', body: JSON.stringify({ body }) },
  );
}

export function rate(
  reference: string,
  score: number,
  comment: string,
): Promise<{ score: number; comment: string | null; submittedAt: string }> {
  return portalRequest(`/tickets/${encodeURIComponent(reference)}/satisfaction`, {
    method: 'POST',
    body: JSON.stringify({ score, comment }),
  });
}

export function downloadAttachment(reference: string, attachmentId: number): Promise<Blob> {
  return portalRequestBlob(`/tickets/${encodeURIComponent(reference)}/attachments/${attachmentId}`);
}

export interface PortalSuggestion {
  slug: string;
  title: string;
  lang: 'ar' | 'en';
  excerpt: string | null;
}

/**
 * Deflection, with an AbortSignal (FR-041, FR-042).
 *
 * The signal is not optional politeness. Search-as-you-type has several requests
 * in flight and they do not return in order, so without cancellation a slow
 * response for "card" lands after a fast one for "card reader" and overwrites it
 * — the customer watches their suggestions become wrong as they finish typing,
 * which reads as the feature being broken. Phase 7 hit this exactly and added the
 * signal for the same reason.
 */
export function suggestions(
  text: string,
  signal?: AbortSignal,
): Promise<{ items: PortalSuggestion[] }> {
  return portalRequest<{ items: PortalSuggestion[] }>(
    `/kb/suggestions?text=${encodeURIComponent(text)}`,
    { signal },
  );
}

export function searchHelp(query: string, lang: 'ar' | 'en', signal?: AbortSignal) {
  return portalRequest<{
    items: Array<{
      slug: string;
      title: string;
      lang: 'ar' | 'en';
      excerpt: string | null;
      categoryName: string | null;
    }>;
    otherLanguage: number;
  }>(`/kb/search?q=${encodeURIComponent(query)}&lang=${lang}`, { signal });
}

export function helpCategories() {
  return portalRequest<{
    items: Array<{
      slug: string;
      nameEn: string | null;
      nameAr: string | null;
      articles: Array<{ slug: string; titleEn: string | null; titleAr: string | null }>;
    }>;
  }>('/kb/categories');
}

export function helpArticle(slug: string, lang: 'ar' | 'en') {
  return portalRequest<{
    slug: string;
    title: string;
    body: string;
    lang: 'ar' | 'en';
    availableLanguages: Array<'ar' | 'en'>;
  }>(`/kb/articles/${encodeURIComponent(slug)}?lang=${lang}`);
}
