import { http } from './http';

/** Internal notes on a ticket, and the users who may be mentioned in them. */

export interface NoteMention {
  id: number;
  fullName: string;
  /** A deactivated mentioned user still renders, marked (FR-035). */
  isActive: boolean;
}

export interface TicketNote {
  id: number;
  ticketId: number;
  /**
   * Contains `@[user:12]` tokens, NOT display names.
   *
   * Render each one from `mentions`, so a rename or deactivation never
   * misattributes an old note (FR-041).
   */
  body: string;
  author: { id: number; fullName: string; isActive: boolean } | null;
  mentions: NoteMention[];
  editedAt: string | null;
  createdAt: string;
}

export interface NotePage {
  items: TicketNote[];
  page: number;
  pageSize: number;
  total: number;
}

export const MENTION_TOKEN = /@\[user:(\d+)\]/g;

export function fetchNotes(ticketId: number, page = 1): Promise<NotePage> {
  return http.get<NotePage>(`/tickets/${ticketId}/notes?page=${page}`);
}

export function createNote(ticketId: number, body: string): Promise<TicketNote> {
  return http.post<TicketNote>(`/tickets/${ticketId}/notes`, { body });
}

export function updateNote(ticketId: number, noteId: number, body: string): Promise<TicketNote> {
  return http.patch<TicketNote>(`/tickets/${ticketId}/notes/${noteId}`, { body });
}

/**
 * Only users who CAN VIEW this ticket, so the picker never offers someone the
 * save would then refuse (FR-036 with FR-037).
 */
export function fetchMentionableUsers(
  ticketId: number,
  q: string,
): Promise<{ items: NoteMention[] }> {
  const search = q.trim() === '' ? '' : `?q=${encodeURIComponent(q.trim())}`;
  return http.get<{ items: NoteMention[] }>(`/tickets/${ticketId}/mentionable-users${search}`);
}
