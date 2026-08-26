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
