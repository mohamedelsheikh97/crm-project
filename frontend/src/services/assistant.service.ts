import { portalRequest } from './portal-http';

/**
 * The customer assistant (Phase 9, US3).
 *
 * GOES THROUGH THE PORTAL CLIENT, never the staff one. Phase 8's D13 built two
 * HTTP clients and two stores precisely so the correct thing is the easy thing:
 * a single client would attach whichever token it happened to hold, and the
 * confusing 401s that followed would invite somebody to "fix" the server.
 */

export interface AssistantCitedArticle {
  /** Slug and title only. No customer surface exposes an internal id (Phase 8 FR-065). */
  slug: string | null;
  title: string;
}

export interface AssistantReply {
  conversationId: number;
  reply: { body: string; citedArticles: AssistantCitedArticle[] };
  /** True when the assistant declined and a person should take over. */
  needsHuman: boolean;
}

export interface EscalationResult {
  ticketReference: string;
}

export function sendMessage(body: string, conversationId: number | null): Promise<AssistantReply> {
  return portalRequest<AssistantReply>('/assistant/messages', {
    method: 'POST',
    body: JSON.stringify({ body, conversationId }),
  });
}

export function escalate(conversationId: number): Promise<EscalationResult> {
  return portalRequest<EscalationResult>('/assistant/escalate', {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  });
}
