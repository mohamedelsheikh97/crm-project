import { useAuthStore, type SessionUser } from '../stores/auth.store';

import { http } from './http';

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

/**
 * Features talk to services like this one; no component imports http.ts
 * directly (FR-015).
 */
export async function login(email: string, password: string): Promise<SessionUser> {
  const result = await http.post<LoginResponse>('/auth/login', { email, password });

  useAuthStore().setSession(result.accessToken, result.user);

  return result.user;
}

export async function logout(): Promise<void> {
  try {
    await http.post<void>('/auth/logout');
  } finally {
    useAuthStore().clear();
  }
}

export async function fetchMe(): Promise<SessionUser> {
  return http.get<SessionUser>('/auth/me');
}
