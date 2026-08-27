import { useAuthStore, type SessionUser } from '../stores/auth.store';

import { http } from './http';

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: { id: number; email: string };
}

/**
 * Features talk to services like this one; no component imports http.ts
 * directly (FR-015).
 */
export async function fetchMe(): Promise<SessionUser> {
  return http.get<SessionUser>('/auth/me');
}

/**
 * Signs in, then reads the session back from /auth/me rather than trusting the
 * login response for role and permissions. One source of truth, and it means
 * the permission set is always the server's current answer (research.md D13).
 */
export async function login(email: string, password: string): Promise<SessionUser> {
  const auth = useAuthStore();
  const result = await http.post<LoginResponse>('/auth/login', { email, password });

  auth.setAccessToken(result.accessToken);

  const user = await fetchMe();
  auth.setUser(user);

  return user;
}

export async function logout(): Promise<void> {
  try {
    await http.post<void>('/auth/logout');
  } finally {
    useAuthStore().clear();
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await http.post<void>('/auth/change-password', { currentPassword, newPassword });

  // The flag is cleared server-side; re-read so the router guard stops
  // redirecting to the change screen.
  useAuthStore().setUser(await fetchMe());
}

/**
 * Restores a session on application start.
 *
 * The access token lives in memory only (Phase 0 D5/D6), so a page load always
 * begins with none. The httpOnly refresh cookie is what survives — and
 * `http.ts` already turns a 401 into one refresh attempt plus a retry, so
 * simply asking for /auth/me is enough: no token means 401, the wrapper
 * refreshes from the cookie, and the retry succeeds.
 *
 * Returns false when there is no usable session. That is the ordinary case for
 * a signed-out visitor, not an error.
 */
export async function restoreSession(): Promise<boolean> {
  const auth = useAuthStore();

  try {
    auth.setUser(await fetchMe());
    return true;
  } catch {
    auth.clear();
    return false;
  }
}
