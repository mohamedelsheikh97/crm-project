import { usePortalStore } from '../stores/portal.store';

import { ApiError } from './http';

/**
 * THE PORTAL'S OWN HTTP CLIENT (Phase 8, research.md D13).
 *
 * The same shape as `http.ts` and deliberately not the same instance. The
 * duplication is the point, and it is small: this file attaches only the PORTAL
 * token and refreshes only against the PORTAL endpoint.
 *
 * A shared client with one auth interceptor would attach whichever token it held
 * to whichever call was made — a staff token to a portal endpoint, or the
 * reverse. The server refuses both, because the realms are signed with different
 * secrets, so this is not a security hole. It is worse in a subtler way: it
 * produces 401s that look like bugs, and the obvious "fix" for a 401 that looks
 * like a bug is to relax the server.
 *
 * `ApiError` is imported rather than redefined: an error shape IS shared, because
 * both surfaces talk to the same error envelope.
 */

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL;

function buildUrl(path: string): string {
  return `${BASE_URL.replace(/\/$/, '')}/portal/${path.replace(/^\//, '')}`;
}

let refreshPromise: Promise<boolean> | null = null;

function buildHeaders(init: RequestInit, token: string | null): Headers {
  const headers = new Headers(init.headers);

  // NO FormData BRANCH, unlike `http.ts`, and its absence is a requirement
  // rather than an omission: the portal accepts no uploads at all (FR-022), and
  // the server refuses a multipart body outright. A client that knew how to send
  // one would be the first step towards someone wiring up a control for it.
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) headers.set('Authorization', `Bearer ${token}`);

  return headers;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    const error = body?.error;

    if (error?.code) {
      const { error: _envelope, ...siblings } = body as Record<string, unknown>;
      return new ApiError(
        response.status,
        error.code,
        error.message ?? '',
        error.details ?? [],
        siblings,
      );
    }
  } catch {
    // Fall through.
  }

  return new ApiError(response.status, 'INTERNAL_ERROR', response.statusText);
}

async function performRefresh(): Promise<boolean> {
  const portal = usePortalStore();

  const response = await fetch(buildUrl('/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    portal.clear();
    return false;
  }

  const body = (await response.json()) as { accessToken: string };
  portal.setAccessToken(body.accessToken);
  return true;
}

function refreshOnce(): Promise<boolean> {
  refreshPromise ??= performRefresh()
    .catch(() => {
      usePortalStore().clear();
      return false;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const portal = usePortalStore();

  return fetch(buildUrl(path), {
    ...init,
    // Sends the httpOnly portal refresh cookie. Scoped to /api/portal/auth by
    // the server, so it is never sent to a staff endpoint.
    credentials: 'include',
    headers: buildHeaders(init, portal.accessToken),
  });
}

export async function portalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await send(path, init);

  if (response.status === 401) {
    const refreshed = await refreshOnce();

    if (!refreshed) throw await toApiError(response);

    response = await send(path, init);
  }

  if (!response.ok) throw await toApiError(response);

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/**
 * An attachment download.
 *
 * Goes through the same path so the Authorization header, the single-flight
 * refresh, and the retry all still apply. A plain anchor would arrive
 * unauthenticated and get a 401 the customer would read as a broken link.
 */
export async function portalRequestBlob(path: string): Promise<Blob> {
  let response = await send(path, { method: 'GET' });

  if (response.status === 401) {
    const refreshed = await refreshOnce();

    if (!refreshed) throw await toApiError(response);

    response = await send(path, { method: 'GET' });
  }

  if (!response.ok) throw await toApiError(response);

  return response.blob();
}

/**
 * Requests that must NOT carry a session or attempt a refresh: sign-in,
 * credential recovery, and invitation acceptance.
 *
 * Separate from `portalRequest` because a 401 from sign-in is an answer, not a
 * stale token — routing it through the refresh path would turn "wrong password"
 * into a pointless round-trip and, worse, would clear a session the customer
 * still had in another tab.
 */
export async function portalPublicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(buildUrl(path), { ...init, credentials: 'include', headers });

  if (!response.ok) throw await toApiError(response);

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}
