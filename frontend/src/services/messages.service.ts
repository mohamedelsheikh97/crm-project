import { http } from './http';

/**
 * CUSTOMER CORRESPONDENCE — deliberately a separate module from
 * `ticket-notes.service.ts`, calling separate endpoints (FR-044, SC-006).
 *
 * There is no shared "composer service" with a flag deciding whether the text
 * reaches a colleague or a customer. A wrong flag would be a disclosure; two
 * modules make that mistake unwritable.
 */

export type MessageChannel = 'email' | 'whatsapp' | 'sms' | 'chat' | 'form';

export type DeliveryState = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MessageAttachment {
  id: number;
  fileName: string;
  contentType: string;
  byteSize: number;
}

export interface TicketMessage {
  id: number;
  channel: MessageChannel;
  direction: 'inbound' | 'outbound';
  author: { id: number; fullName: string } | null;
  senderIdentity: string | null;
  /** Always safe to render as text — the server has already stripped markup. */
  body: string;
  bodyFormat: 'text' | 'html_source';
  attachments: MessageAttachment[];
  deliveryState: DeliveryState;
  deliveryDetail: string | null;
  occurredAt: string;
}

export interface MessagePage {
  items: TicketMessage[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * What the composer needs BEFORE the agent types (FR-051, FR-057).
 *
 * Telling somebody what they may send is a different product from refusing what
 * they wrote, and this is the call that makes the first one possible.
 */
export interface ComposerContext {
  conversation: {
    channel: MessageChannel;
    recipientIdentity: string;
    providerConversationId: string | null;
  } | null;
  optOut: { channel: MessageChannel; optedOutAt: string; source: string } | null;
  window: { freeformAllowed: boolean; reopensAt: string | null; allowedTemplates: string[] } | null;
}

export function fetchMessages(ticketId: number, page = 1): Promise<MessagePage> {
  return http.get<MessagePage>(`/tickets/${ticketId}/messages?page=${page}`);
}

export function fetchComposerContext(ticketId: number): Promise<ComposerContext> {
  return http.get<ComposerContext>(`/tickets/${ticketId}/messages/context`);
}

/**
 * The CHANNEL IS NOT SENT. It is derived from the conversation server-side, so
 * this client cannot redirect a reply to a channel the customer never used.
 */
export function sendMessage(ticketId: number, body: string): Promise<TicketMessage> {
  return http.post<TicketMessage>(`/tickets/${ticketId}/messages`, { body });
}

export function reattribute(
  ticketId: number,
  customerId: number,
  version: number,
): Promise<{ ticketId: number; customerId: number }> {
  return http.post(`/tickets/${ticketId}/reattribute`, { customerId, version });
}
