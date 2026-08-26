import { describe, expect, it } from 'vitest';

import ar from '../../src/locales/ar.json';
import en from '../../src/locales/en.json';

/**
 * quickstart A13 / FR-044 / SC-010 (research.md D14).
 *
 * Phase 0 checked this by hand with a `node -e` one-liner, which worked at 14
 * keys. This phase has roughly ten times that, and a check that must be
 * remembered will be forgotten — while a key present in one file and missing
 * from the other renders a raw machine key to a user.
 */
describe('locale files', () => {
  it('hold identical key sets', () => {
    const enKeys = Object.keys(en).sort();
    const arKeys = Object.keys(ar).sort();

    expect(arKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
    expect(enKeys.filter((key) => !arKeys.includes(key))).toEqual([]);
  });

  it('has no empty values in either language', () => {
    for (const [locale, messages] of [
      ['en', en],
      ['ar', ar],
    ] as const) {
      const empty = Object.entries(messages)
        .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
        .map(([key]) => `${locale}:${key}`);

      expect(empty).toEqual([]);
    }
  });

  it('translates every audit action key the backend can emit', () => {
    // A missing one renders `user.role.changed` to an Administrator.
    const actions = [
      'auth.login.success',
      'auth.login.failure',
      'auth.logout',
      'auth.password.changed',
      'auth.password.reset',
      'auth.account.locked',
      'auth.account.unlocked',
      'user.created',
      'user.updated',
      'user.deactivated',
      'user.reactivated',
      'user.role.changed',
      'role.permissions.changed',
      'data.exported',
      'record.deleted',
    ];

    const missing = actions.filter((action) => !(`audit.action.${action}` in en));

    expect(missing).toEqual([]);
  });

  it('translates every permission key in the catalog', () => {
    const permissions = [
      'users.view',
      'users.create',
      'users.update',
      'users.deactivate',
      'users.reset_password',
      'roles.view',
      'roles.update_permissions',
      'audit.view',
      'settings.view',
    ];

    const missing = permissions.filter((key) => !(`permission.action.${key}` in en));

    expect(missing).toEqual([]);
  });
});
