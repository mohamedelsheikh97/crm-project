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

  // A fresh sign-in IS a restored session, so record it as one. Without this
  // the guard would re-ask /auth/me on the next navigation after a
  // sign-out-then-sign-in, for an answer it already has.
  markSessionRestored();

  return user;
}

export async function logout(): Promise<void> {
  try {
    await http.post<void>('/auth/logout');
  } finally {
    useAuthStore().clear();
    // Forget the cached restore, or signing back in within the same page load
    // would be answered from a promise that resolved for the previous session.
    resetSessionRestore();
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

/**
 * The single restore attempt for this page load, shared by everyone who needs
 * to know whether a session exists.
 *
 * THE ROUTER GUARD AWAITS THIS, and that is not belt-and-braces — it is the
 * only thing that makes the guard correct. `app.use(router)` starts the initial
 * navigation IMMEDIATELY, inside `install()`, rather than waiting for
 * `app.mount()`. So the first `beforeEach` runs before any code that follows
 * `app.use(router)` in main.ts, including the restore. Left to ordering, the
 * first guard always saw a null access token — the token lives in memory only
 * (D5/D6), so a page load starts with none — and bounced every `requiresAuth`
 * route to the login screen despite a perfectly valid refresh cookie.
 *
 * Single-flight, so the guard and the bootstrap share one `/auth/me` rather
 * than racing two.
 */
let restoreOnce: Promise<boolean> | null = null;

export function ensureSessionRestored(): Promise<boolean> {
  restoreOnce ??= restoreSession();
  return restoreOnce;
}

/**
 * Forgets the restore result, so the next call re-asks.
 *
 * Needed after signing out: without it, a user who signs out and signs back in
 * within the same page load would be answered from a stale promise.
 */
export function resetSessionRestore(): void {
  restoreOnce = null;
}

/** Records that the session is already known, without asking again. */
export function markSessionRestored(): void {
  restoreOnce = Promise.resolve(true);
}
