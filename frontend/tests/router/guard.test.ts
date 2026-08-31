import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import router from '../../src/router';
import { markSessionRestored, resetSessionRestore } from '../../src/services/auth.service';
import { useAuthStore, type SessionUser } from '../../src/stores/auth.store';

function signIn(overrides: Partial<SessionUser> = {}): void {
  const auth = useAuthStore();

  auth.setSession('test-token', {
    id: 1,
    email: 'admin@crm.local',
    fullName: 'Admin',
    role: { key: 'admin', nameKey: 'role.name.admin' },
    permissions: ['users:view', 'roles:view', 'audit:view', 'settings:view'],
    mustChangePassword: false,
    ...overrides,
  });
}

beforeEach(async () => {
  setActivePinia(createPinia());

  // The guard awaits session restoration before reading the store, so that a
  // refresh on a guarded route is not bounced to login while the access token
  // (memory-only) is still absent. These tests seed the store by hand, so the
  // restore is declared already done — otherwise every navigation here would
  // issue a real /auth/me, and a failed one would call `auth.clear()` and wipe
  // the session the test just set up.
  resetSessionRestore();
  markSessionRestored();

  await router.replace('/');
  await router.isReady();
});

/**
 * These exist because of a real defect: with no login screen and no session
 * bootstrap, every guarded route bounced to home and the application was
 * unusable. A guard that silently redirects is exactly the kind of bug that
 * looks like "nothing happens", so it gets tests.
 */
describe('router guard', () => {
  it('sends an anonymous visitor to login, remembering where they were going', async () => {
    await router.push('/admin/users');

    expect(router.currentRoute.value.name).toBe('login');
    // Without this the user signs in and lands on the home page, having lost
    // whatever they were trying to reach.
    expect(router.currentRoute.value.query.redirect).toBe('/admin/users');
  });

  it('lets a permitted signed-in user through', async () => {
    signIn();

    await router.push('/admin/users');

    expect(router.currentRoute.value.name).toBe('admin-users');
  });

  it('redirects a signed-in user who lacks the permission, and says so', async () => {
    signIn({ permissions: ['settings:view'] });

    await router.push('/admin/users');

    expect(router.currentRoute.value.name).toBe('home');
    // Bounced with no explanation reads like a broken link rather than a refusal.
    expect(router.currentRoute.value.query.denied).toBe('1');
  });

  it('keeps a user owing a password change on that screen', async () => {
    signIn({ mustChangePassword: true });

    await router.push('/admin/users');

    expect(router.currentRoute.value.name).toBe('change-password');
  });

  it('keeps a signed-in user off the login screen', async () => {
    signIn();

    await router.push('/login');

    expect(router.currentRoute.value.name).toBe('home');
  });

  it('leaves public routes reachable while signed out', async () => {
    await router.push('/login');
    expect(router.currentRoute.value.name).toBe('login');

    await router.push('/');
    expect(router.currentRoute.value.name).toBe('home');
  });

  it('has a login route at all', () => {
    // The original defect: the application had no way in.
    expect(router.hasRoute('login')).toBe(true);
  });
});
