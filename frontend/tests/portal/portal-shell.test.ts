import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

import App from '../../src/App.vue';
import ar from '../../src/locales/ar.json';
import en from '../../src/locales/en.json';

/**
 * THE THIRD SHELL (Phase 8, FR-063, research.md D13).
 *
 * `App.vue` chose between two shells until this phase. The portal is neither:
 * authenticated, but not the staff application. What must never happen is a
 * customer being shown staff navigation — a door they cannot open, on a surface
 * where they are not a colleague.
 *
 * Asserted here rather than left to review, because the failure is one missing
 * line of route meta and it would look completely normal in a diff.
 */

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en, ar },
});

const Blank = { template: '<p>content</p>' };

const routes: RouteRecordRaw[] = [
  { path: '/staff', name: 'staff', component: Blank, meta: {} },
  // `DefaultLayout` links to both by name. Declared here because the staff shell
  // is one of the three things under test and it cannot render without them —
  // not padding, but the minimum world it needs to exist in.
  { path: '/', name: 'home', component: Blank, meta: {} },
  { path: '/login', name: 'login', component: Blank, meta: {} },
  { path: '/help', name: 'help', component: Blank, meta: { publicShell: true } },
  { path: '/portal', name: 'portal-requests', component: Blank, meta: { portalShell: true } },
  { path: '/portal/login', name: 'portal-login', component: Blank, meta: { portalShell: true } },
  {
    path: '/portal/requests/new',
    name: 'portal-new-request',
    component: Blank,
    meta: { portalShell: true },
  },
  { path: '/portal/help', name: 'portal-help', component: Blank, meta: { portalShell: true } },
];

async function mountAt(path: string) {
  const router = createRouter({ history: createWebHistory(), routes });
  await router.push(path);
  await router.isReady();

  return mount(App, { global: { plugins: [router, i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('shell selection', () => {
  it('renders the portal shell for a portalShell route', async () => {
    const wrapper = await mountAt('/portal');

    expect(wrapper.text()).toContain(en['portal.title']);
    // AND NO STAFF CHROME. The staff shell's own navigation labels must not
    // appear anywhere on a customer's screen.
    expect(wrapper.text()).not.toContain(en['nav.dashboard']);
    expect(wrapper.text()).not.toContain(en['nav.customers']);
    expect(wrapper.text()).not.toContain(en['nav.admin']);
    expect(wrapper.text()).not.toContain(en['nav.tickets']);
  });

  it('renders nothing but the view for a publicShell route', async () => {
    const wrapper = await mountAt('/help');

    expect(wrapper.text()).not.toContain(en['portal.title']);
    expect(wrapper.text()).not.toContain(en['nav.dashboard']);
  });

  it('renders the staff shell for everything else', async () => {
    const wrapper = await mountAt('/staff');

    expect(wrapper.text()).toContain(en['app.title']);
    expect(wrapper.text()).not.toContain(en['portal.nav.requests']);
  });
});

describe('the portal shell offers no staff navigation on any portal route', () => {
  const forbidden = ['nav.dashboard', 'nav.customers', 'nav.tickets', 'nav.admin', 'admin.title'];

  for (const path of ['/portal', '/portal/login', '/portal/requests/new', '/portal/help']) {
    it(`${path} shows only customer navigation`, async () => {
      const wrapper = await mountAt(path);
      const text = wrapper.text();

      for (const key of forbidden) {
        expect(text).not.toContain(en[key as keyof typeof en]);
      }
    });
  }

  it('offers the language switch before sign-in', async () => {
    // The login and invitation screens are the first thing an Arabic-speaking
    // customer sees. A switch that only appears after signing in is a switch they
    // cannot reach.
    //
    // Asserted through the toggle's OWN accessible label rather than a substring
    // of the markup — the first version of this test looked for "lang" in the
    // HTML, which is a property of the implementation rather than of the promise.
    const wrapper = await mountAt('/portal/login');

    // Its visible text is the language's NAME; "Switch to Arabic" is its
    // accessible label. Both are asserted, because a control whose only label is
    // visual is not reachable by a screen reader (Principle IV).
    expect(wrapper.text()).toContain(en['language.name.ar']);
    expect(wrapper.html()).toContain(en['language.switchTo.ar']);
    // And the signed-in controls are absent: there is no session yet.
    expect(wrapper.text()).not.toContain(en['portal.signOut']);
  });
});
