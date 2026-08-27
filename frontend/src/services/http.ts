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

  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
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

  if (init.body !== undefined && !headers.has('Content-Type')) {
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
      return new ApiError(response.status, error.code, error.message ?? '', error.details ?? []);
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

export const http = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => withBody<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => withBody<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => withBody<T>('PUT', path, body),
};

function withBody<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
