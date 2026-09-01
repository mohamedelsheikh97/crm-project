import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * THE PORTAL SESSION, HELD SEPARATELY FROM THE STAFF ONE (Phase 8, research D13).
 *
 * A deliberate sibling of `auth.store`, not a mode inside it.
 *
 * Two sessions must be able to coexist in one browser: an agent testing the
 * portal is an ordinary thing to do, and signing into one surface must not
 * silently sign them out of the other. One store with one `accessToken` would
 * make that impossible, and the failure would look like a bug rather than a
 * design decision.
 *
 * It also keeps the front-end half of the realm separation honest. A single store
 * feeding a single HTTP client would attach whichever token it happened to hold
 * to whichever call was made. The server refuses that in both directions — the
 * two realms are signed with different secrets — so it is not a security hole,
 * but it produces confusing 401s and invites somebody to "fix" it by relaxing the
 * server. Two stores make the correct thing the easy thing.
 *
 * `sessionStorage`, NOT `localStorage`. A customer's portal session on a shared
 * or family device should not survive the tab being closed; the refresh cookie
 * is what carries a session across visits, and it is httpOnly.
 */

const TOKEN_KEY = 'crm.portal.accessToken';
const EMAIL_KEY = 'crm.portal.email';

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // Private browsing, or storage disabled. A portal that will not load because
    // storage is unavailable is worse than one that asks for a password again.
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Ignored for the same reason.
  }
}

export const usePortalStore = defineStore('portal', () => {
  const accessToken = ref<string | null>(read(TOKEN_KEY));
  const email = ref<string | null>(read(EMAIL_KEY));
  /** NULL means the customer has not chosen; the interface falls back to the app's locale. */
  const language = ref<'ar' | 'en' | null>(null);

  function setSession(token: string, customer: { email: string; language: 'ar' | 'en' | null }) {
    accessToken.value = token;
    email.value = customer.email;
    language.value = customer.language;
    write(TOKEN_KEY, token);
    write(EMAIL_KEY, customer.email);
  }

  function setAccessToken(token: string) {
    accessToken.value = token;
    write(TOKEN_KEY, token);
  }

  function clear() {
    accessToken.value = null;
    email.value = null;
    language.value = null;
    write(TOKEN_KEY, null);
    write(EMAIL_KEY, null);
  }

  return { accessToken, email, language, setSession, setAccessToken, clear };
});
