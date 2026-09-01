import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

import NewRequestView from '../../src/views/portal/NewRequestView.vue';
import RequestListView from '../../src/views/portal/RequestListView.vue';
import ar from '../../src/locales/ar.json';
import en from '../../src/locales/en.json';
import * as portalService from '../../src/services/portal.service';

/**
 * TWO THINGS THAT MUST NOT BE ON THESE SCREENS, AND ONE THAT MUST
 * (Phase 8, FR-022, FR-022a, FR-042, SC-021, SC-030).
 *
 * The upload control is the interesting one. Clarifications Q3 declined inbound
 * files, and the temptation on a form is to render a disabled file input "so the
 * customer knows it is coming". A disabled control invites clicking and explains
 * nothing; a sentence saying how to send a file actually answers the question.
 */

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en, ar },
});

const routes: RouteRecordRaw[] = [
  { path: '/portal', name: 'portal-requests', component: { template: '<div/>' } },
  { path: '/portal/requests/new', name: 'portal-new-request', component: { template: '<div/>' } },
  {
    path: '/portal/requests/:reference',
    name: 'portal-request',
    component: { template: '<div/>' },
  },
  { path: '/portal/help/:slug', name: 'portal-help-article', component: { template: '<div/>' } },
];

function makeRouter() {
  return createRouter({ history: createWebHistory(), routes });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe('the new-request form (FR-022a, FR-042)', () => {
  async function mountForm() {
    const router = makeRouter();
    await router.push('/portal/requests/new');
    await router.isReady();

    return mount(NewRequestView, { global: { plugins: [router, i18n] } });
  }

  it('offers no file input at all — not even a disabled one', async () => {
    const wrapper = await mountForm();

    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.findAll('input[disabled]')).toHaveLength(0);
  });

  it('says how to send a file instead', async () => {
    const wrapper = await mountForm();

    expect(wrapper.text()).toContain(en['portal.noUploads']);
  });

  it('never disables submit while suggestions are loading', async () => {
    // A form that waits for a search before it will submit is the failure Phase 7
    // wrote its deflection tests for. It looks harmless in a diff — an await, a
    // disabled button while loading — and it means a customer with a problem
    // cannot reach a person when the search is slow.
    let resolveSuggestions: (value: { items: [] }) => void = () => {};

    vi.spyOn(portalService, 'suggestions').mockReturnValue(
      new Promise((resolve) => {
        resolveSuggestions = resolve;
      }),
    );

    const wrapper = await mountForm();

    await wrapper.find('#request-description').setValue('my card reader will not turn on');
    await flushPromises();

    const submit = wrapper.find('button[type="submit"]');
    expect(submit.attributes('disabled')).toBeUndefined();

    resolveSuggestions({ items: [] });
  });

  it('shows no suggestion panel when there is nothing to offer (FR-044)', async () => {
    vi.spyOn(portalService, 'suggestions').mockResolvedValue({ items: [] });

    const wrapper = await mountForm();
    await wrapper.find('#request-description').setValue('something entirely unrelated');
    await flushPromises();

    // Silence, not an empty panel saying "no results". Noise beside a submit
    // button is worse than nothing.
    expect(wrapper.find('aside').exists()).toBe(false);
  });
});

describe('the empty request list (SC-021, research D4)', () => {
  async function mountList() {
    const router = makeRouter();
    await router.push('/portal');
    await router.isReady();

    const wrapper = mount(RequestListView, { global: { plugins: [router, i18n] } });
    await flushPromises();
    return wrapper;
  }

  it('reads as normal, not as an error', async () => {
    vi.spyOn(portalService, 'listRequests').mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });

    const wrapper = await mountList();

    // THE FIRST EXPERIENCE OF MOST NEWLY INVITED CUSTOMERS, because FR-026f makes
    // an unassociated ticket invisible and most historical tickets are
    // unassociated. If this looks like a failure, the portal looks broken on day
    // one to almost everybody who is invited to it.
    expect(wrapper.text()).toContain(en['portal.requests.empty.title']);
    expect(wrapper.text()).not.toContain(en['portal.error.unexpected']);

    // Announced, so somebody using a screen reader can tell "nothing here" from
    // "still loading".
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it('offers the way to raise one, and explains the missing history', async () => {
    vi.spyOn(portalService, 'listRequests').mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });

    const wrapper = await mountList();

    expect(wrapper.text()).toContain(en['portal.nav.newRequest']);
    // The quieter half, for the customer who expected to see earlier requests.
    expect(wrapper.text()).toContain(en['portal.requests.empty.history']);
  });

  it('shows a failure as a failure, distinctly from emptiness', async () => {
    vi.spyOn(portalService, 'listRequests').mockRejectedValue(new Error('offline'));

    const wrapper = await mountList();

    expect(wrapper.text()).toContain(en['portal.error.unexpected']);
    expect(wrapper.text()).not.toContain(en['portal.requests.empty.title']);
  });
});
