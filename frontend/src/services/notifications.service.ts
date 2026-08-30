import { useAuthStore } from '../stores/auth.store';

import { http } from './http';

/**
 * Notifications, and the live stream that accelerates them.
 *
 * THE ROW IS THE TRUTH. Every notification is persisted before it is emitted,
 * so losing the stream costs latency and never a notification. That is what
 * lets the reconnection logic below be as simple as "back off, reconnect, ask
 * for anything newer than the last id I saw".
 */

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL;

export type NotificationType =
  'ticket.assigned' | 'note.mentioned' | 'task.reminder' | 'ticket.due_soon';

export interface NotificationView {
  id: number;
  /**
   * The client composes the sentence from `notification.type.*` locale keys.
   *
   * There is NO message field on the wire, and none is to be added: the same
   * row is read by an Arabic user and an English one, so the language cannot be
   * decided on the server (Principle I).
   */
  type: NotificationType;
  actor: { id: number; fullName: string } | null;
  /** Already resolved through any merge chain by the server (FR-052). */
  ticket: { id: number; reference: string; subject: string } | null;
  task: { id: number; title: string } | null;
  noteId: number | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationView[];
  page: number;
  pageSize: number;
  total: number;
  /** Rides along on every page, so the badge never needs a second request. */
  unreadCount: number;
}

export interface NotificationQuery {
  unreadOnly?: boolean;
  /** Everything newer than this id — the catch-up after a reconnect. */
  since?: number;
  page?: number;
  pageSize?: number;
}

export function fetchNotifications(query: NotificationQuery = {}): Promise<NotificationPage> {
  const params = new URLSearchParams();

  if (query.unreadOnly) params.set('unreadOnly', 'true');
  if (query.since !== undefined) params.set('since', String(query.since));
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));

  const search = params.toString();

  return http.get<NotificationPage>(`/notifications${search === '' ? '' : `?${search}`}`);
}

export function markRead(id: number): Promise<NotificationView> {
  return http.post<NotificationView>(`/notifications/${id}/read`);
}

export function markAllRead(): Promise<{ unreadCount: number }> {
  return http.post<{ unreadCount: number }>('/notifications/read-all');
}

/**
 * Opens the live stream.
 *
 * `fetch` + `ReadableStream`, deliberately NOT `EventSource`. EventSource
 * cannot set an `Authorization` header, and this project's access token is a
 * Bearer header held in memory — using EventSource would force the token into
 * the query string, where the server's request logger writes it into the URL
 * log. A credential in the logs is the same defect as not having one.
 *
 * Returns when the stream ends for any reason. The caller decides whether to
 * reconnect; this function does not retry, so the backoff policy lives in one
 * place (useNotificationStream).
 *
 * @throws {StreamUnauthorised} when the access token is rejected, so the caller
 * can refresh once and reconnect rather than backing off pointlessly.
 */
export class StreamUnauthorised extends Error {
  constructor() {
    super('The notification stream rejected the access token.');
    this.name = 'StreamUnauthorised';
  }
}

export async function openNotificationStream(
  onNotification: (notification: NotificationView) => void,
  signal: AbortSignal,
): Promise<void> {
  const auth = useAuthStore();
  const url = `${BASE_URL.replace(/\/$/, '')}/notifications/stream`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
    },
    credentials: 'include',
    signal,
  });

  if (response.status === 401) {
    throw new StreamUnauthorised();
  }

  if (!response.ok || !response.body) {
    throw new Error(`The notification stream failed to open (${response.status}).`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) return;

      buffer += value;

      // SSE frames are separated by a blank line. A chunk can split a frame, so
      // anything after the last separator stays in the buffer for the next read.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          // Comment frames (': keep-alive') carry no data and are skipped —
          // they exist so an idle proxy does not close the connection, and so
          // the client can tell "quiet" from "dead".
          if (!line.startsWith('data:')) continue;

          try {
            onNotification(JSON.parse(line.slice(5).trim()) as NotificationView);
          } catch {
            // A malformed frame must not tear down a working stream. The
            // catch-up query will collect anything this drops.
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {
      // Cancelling an already-closed stream is not an error worth surfacing.
    });
  }
}
