import { useAuthStore } from '../stores/auth.store';

// The single source of the backend base path, so Phase 11's version segment is
// a one-line change here (FR-021).
const BASE_URL: string = import.meta.env.VITE_API_BASE_URL;

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ApiErrorDetail[];

  /**
   * Sibling keys the server sent alongside `error`.
   *
   * Phase 2 adds one: a `409 DUPLICATE_CUSTOMER` carries the matching records
   * in `duplicates`. They travel beside the envelope rather than inside
   * `details`, which is `{field, message}` pairs with a defined meaning.
   */
  readonly payload: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: ApiErrorDetail[] = [],
    payload: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.payload = payload;
  }
}

/**
 * Shared across concurrent callers so parallel 401s trigger exactly one refresh
 * rather than one each (research.md D6).
 */
let refreshPromise: Promise<boolean> | null = null;

function buildUrl(path: string): string {
  return `${BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function buildHeaders(init: RequestInit, token: string | null): Headers {
  const headers = new Headers(init.headers);

  // A FormData body must carry the browser's own multipart Content-Type,
  // complete with its boundary — setting application/json would make the
  // server unable to parse it.
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;

  if (init.body !== undefined && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    const error = body?.error;

    if (error?.code) {
      // Keep everything the server sent beside `error`, so a caller can read a
      // sibling key without this wrapper needing to know about it.
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
    // Fall through to the generic error below.
  }

  return new ApiError(response.status, 'INTERNAL_ERROR', response.statusText);
}

async function performRefresh(): Promise<boolean> {
  const auth = useAuthStore();

  // Never routed back through `request`: retrying the refresh call would recurse.
  const response = await fetch(buildUrl('/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    auth.clear();
    return false;
  }

  const body = (await response.json()) as { accessToken: string };
  auth.setAccessToken(body.accessToken);
  return true;
}

function refreshOnce(): Promise<boolean> {
  refreshPromise ??= performRefresh()
    .catch(() => {
      useAuthStore().clear();
      return false;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const auth = useAuthStore();

  return fetch(buildUrl(path), {
    ...init,
    // Sends the httpOnly refresh cookie (D5).
    credentials: 'include',
    headers: buildHeaders(init, auth.accessToken),
  });
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await send(path, init);

  if (response.status === 401) {
    const refreshed = await refreshOnce();

    if (!refreshed) {
      throw await toApiError(response);
    }

    // Exactly one retry of the original request (FR-019).
    response = await send(path, init);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * A binary response — an export or an attachment download.
 *
 * Goes through the same request path so the Authorization header, the
 * single-flight refresh, and the retry all still apply. A plain anchor tag
 * would arrive unauthenticated.
 */
export async function requestBlob(path: string): Promise<Blob> {
  let response = await send(path, { method: 'GET' });

  if (response.status === 401) {
    const refreshed = await refreshOnce();

    if (!refreshed) {
      throw await toApiError(response);
    }

    response = await send(path, { method: 'GET' });
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  return response.blob();
}

export const http = {
  /**
   * `signal` is accepted from Phase 7 onward, for search-as-you-type.
   *
   * A search that fires on every keystroke will have several requests in
   * flight, and they do not come back in order. Without cancellation a slow
   * response for "car" can land after a fast one for "card reader" and
   * overwrite it — the reader watches their results become wrong as they finish
   * typing, which reads as the search being broken.
   */
  get: <T>(path: string, options: { signal?: AbortSignal } = {}) =>
    request<T>(path, { method: 'GET', ...(options.signal ? { signal: options.signal } : {}) }),
  getBlob: (path: string) => requestBlob(path),
  post: <T>(path: string, body?: unknown) => withBody<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => withBody<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => withBody<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /**
   * Multipart upload. The body is a FormData, so Content-Type must NOT be set
   * — the browser adds it with the boundary the server needs to parse.
   */
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

function withBody<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
