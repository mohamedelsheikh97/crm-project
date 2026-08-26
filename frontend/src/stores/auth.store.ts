import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export interface SessionUser {
  id: number;
  email: string;
}

/**
 * The access token lives here and nowhere else. It MUST NOT be persisted to
 * localStorage, sessionStorage, or a Pinia persistence plugin — keeping it out
 * of web storage is what removes the standard XSS token-theft path (D5/D6).
 */
export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<SessionUser | null>(null);

  const isAuthenticated = computed(() => accessToken.value !== null);

  function setSession(token: string, sessionUser: SessionUser): void {
    accessToken.value = token;
    user.value = sessionUser;
  }

  function setAccessToken(token: string): void {
    accessToken.value = token;
  }

  function clear(): void {
    accessToken.value = null;
    user.value = null;
  }

  return { accessToken, user, isAuthenticated, setSession, setAccessToken, clear };
});
