import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export interface SessionRole {
  key: string;
  nameKey: string;
}

export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
  role: SessionRole;
  permissions: string[];
  mustChangePassword: boolean;
}

/**
 * The access token lives here and nowhere else. It MUST NOT be persisted to
 * localStorage, sessionStorage, or a Pinia persistence plugin — keeping it out
 * of web storage is what removes the standard XSS token-theft path (Phase 0
 * D5/D6, unchanged by this phase).
 *
 * `permissions` is the resolved key set from GET /api/auth/me. It governs
 * DISPLAY ONLY: every guarded action's endpoint enforces the same permission
 * independently (FR-015, FR-020).
 */
export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<SessionUser | null>(null);

  const isAuthenticated = computed(() => accessToken.value !== null);
  const permissions = computed(() => new Set(user.value?.permissions ?? []));
  const mustChangePassword = computed(() => user.value?.mustChangePassword ?? false);

  function setAccessToken(token: string): void {
    accessToken.value = token;
  }

  function setUser(next: SessionUser | null): void {
    user.value = next;
  }

  function setSession(token: string, sessionUser: SessionUser): void {
    accessToken.value = token;
    user.value = sessionUser;
  }

  function clear(): void {
    accessToken.value = null;
    user.value = null;
  }

  return {
    accessToken,
    user,
    isAuthenticated,
    permissions,
    mustChangePassword,
    setAccessToken,
    setUser,
    setSession,
    clear,
  };
});
