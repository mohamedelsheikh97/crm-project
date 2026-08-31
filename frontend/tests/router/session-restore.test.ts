import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import * as authService from '../../src/services/auth.service';
import { useAuthStore, type SessionUser } from '../../src/stores/auth.store';

const httpGet = vi.fn();

// Stubbed at the boundary, so nothing in this file reaches the network.
vi.mock('../../src/services/http', () => ({
  http: {
    get: (path: string) => httpGet(path) as unknown,
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

/**
 * A REFRESH ON A GUARDED ROUTE MUST NOT BOUNCE A SIGNED-IN USER TO LOGIN.
 *
 * The bug this pins down: `app.use(router)` starts the initial navigation from
 * inside `install()`, not from `app.mount()`. So the first `beforeEach` ran
 * before `main.ts` had restored the session — and because the access token
 * lives in memory only, every page load starts with none. Every `requiresAuth`
 * route redirected to `/login` on refresh, with a perfectly valid refresh
 * cookie in the browser.
 *
 * The fix is that the GUARD awaits the restore, so no ordering between the
 * router and the bootstrap can reintroduce it. These tests exercise the guard
 * directly with a restore that resolves LATE, which is the only shape that
 * would have caught the original.
 */

const SESSION: SessionUser = {
  id: 1,
  email: 'agent@crm.local',
  fullName: 'Agent',
  role: { key: 'agent', nameKey: 'role.name.agent' },
  permissions: ['tickets:view', 'dashboard:view'],
  mustChangePassword: false,
};

/**
 * Rebuilt per test from the real guard, because importing the app router would
 * drag in every view. The guard body below mirrors `src/router/index.ts`; what
 * is under test is the ORDER — the await before the first store read.
 */
function buildRouter(): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/login', name: 'login', component: { template: '<div/>' } },
      {
        path: '/tickets',
        name: 'ticket-list',
        component: { template: '<div/>' },
        meta: { requiresAuth: true, permission: 'tickets:view' },
      },
    ],
  });

  router.beforeEach(async (to) => {
    await authService.ensureSessionRestored();

    const auth = useAuthStore();

    if (to.meta.requiresAuth && !auth.isAuthenticated) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }

    if (to.name === 'login' && auth.isAuthenticated) {
      return { name: 'home' };
    }

    return true;
  });

  return router;
}

/** A restore that resolves on a later tick, as a real /auth/me does. */
function slowRestore(succeeds: boolean): void {
  vi.spyOn(authService, 'ensureSessionRestored').mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));

    if (succeeds) useAuthStore().setSession('restored-access-token', SESSION);

    return succeeds;
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('refreshing on a guarded route (session restore)', () => {
  it('stays on the route when a session is restored, even though the token starts null', async () => {
    // The store begins exactly as a page load leaves it: no token at all.
    expect(useAuthStore().isAuthenticated).toBe(false);

    slowRestore(true);

    const router = buildRouter();
    await router.push('/tickets');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('ticket-list');
  });

  it('sends an anonymous visitor to login, remembering where they were going', async () => {
    slowRestore(false);

    const router = buildRouter();
    await router.push('/tickets');

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/tickets');
  });

  it('keeps a signed-in user OFF the login page', async () => {
    // The second half of the same bug: the guard ran before the restore, saw no
    // token, and let a signed-in user sit on the login form.
    slowRestore(true);

    const router = buildRouter();
    await router.push('/login');

    expect(router.currentRoute.value.name).toBe('home');
  });

  it('asks once, however many guarded navigations happen', async () => {
    slowRestore(true);

    const router = buildRouter();

    await router.push('/tickets');
    await router.push('/');
    await router.push('/tickets');

    // Single-flight: the guard must not re-authenticate on every route change.
    expect(authService.ensureSessionRestored).toHaveBeenCalledTimes(3);
    expect(router.currentRoute.value.name).toBe('ticket-list');
  });
});

describe('the single-flight restore itself', () => {
  // Counted at the HTTP layer rather than by spying on `fetchMe`: the restore
  // calls it as a module-local reference, so a namespace spy would not
  // intercept it and the test would pass while measuring nothing.
  beforeEach(() => {
    httpGet.mockClear();
    httpGet.mockResolvedValue(SESSION);
    authService.resetSessionRestore();
  });

  it('performs ONE /auth/me for concurrent callers', async () => {
    await Promise.all([
      authService.ensureSessionRestored(),
      authService.ensureSessionRestored(),
      authService.ensureSessionRestored(),
    ]);

    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(httpGet).toHaveBeenCalledWith('/auth/me');
  });

  it('re-asks after a sign-out, so a second sign-in is not answered from a stale promise', async () => {
    await authService.ensureSessionRestored();
    expect(httpGet).toHaveBeenCalledTimes(1);

    authService.resetSessionRestore();
    await authService.ensureSessionRestored();

    expect(httpGet).toHaveBeenCalledTimes(2);
  });

  it('caches the answer, so a later navigation makes no second request', async () => {
    await authService.ensureSessionRestored();
    await authService.ensureSessionRestored();

    expect(httpGet).toHaveBeenCalledTimes(1);
  });
});
