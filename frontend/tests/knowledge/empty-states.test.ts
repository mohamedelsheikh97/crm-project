import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import ResultList from '../../src/components/knowledge/ResultList.vue';
import SuggestionPanel from '../../src/components/knowledge/SuggestionPanel.vue';
import ar from '../../src/locales/ar.json';
import en from '../../src/locales/en.json';

vi.mock('../../src/services/knowledge.service', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../src/services/knowledge.service',
  );

  return { ...actual, fetchSuggestions: vi.fn(), detachArticle: vi.fn() };
});

const { fetchSuggestions } = await import('../../src/services/knowledge.service');

/**
 * AN EMPTY STATE IS A FIRST-CLASS STATE (FR-057, SC-013).
 *
 * Every assertion here is about a surface having NOTHING to show, and none of
 * them is cosmetic.
 *
 * A blank region and a component that failed to load are indistinguishable to a
 * reader. Faced with one, they reload, then reload again, then conclude the
 * system is broken — when in fact the honest answer was "there is nothing
 * here". Saying so costs one line and converts a suspected fault into an
 * understood state.
 *
 * The suggestion panel's empty state carries more weight than the others. A
 * panel that always shows three articles teaches agents that the panel means
 * nothing, and once they have stopped reading it, better suggestions cannot
 * win them back. So the panel MUST be able to say "nothing", visibly and
 * without apology.
 */

function i18n(locale: 'en' | 'ar' = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, ar } });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the suggestion panel says when there is nothing (FR-041)', () => {
  it('renders an explicit line rather than a blank region', async () => {
    vi.mocked(fetchSuggestions).mockResolvedValue([]);

    const wrapper = mount(SuggestionPanel, {
      props: { ticketId: 1 },
      global: { plugins: [i18n()], stubs: { RouterLink: true } },
    });

    await flush();

    expect(wrapper.text()).toContain(en['kb.suggestions.empty']);
    expect(wrapper.findAll('li')).toHaveLength(0);
  });

  it('distinguishes "nothing to suggest" from "could not load"', async () => {
    // THE DISTINCTION THAT MATTERS. A failed fetch rendered as "nothing to
    // suggest" quietly teaches the agent something false about the corpus —
    // that there is no article about this — and they stop looking.
    vi.mocked(fetchSuggestions).mockRejectedValue(new Error('offline'));

    const wrapper = mount(SuggestionPanel, {
      props: { ticketId: 1 },
      global: { plugins: [i18n()], stubs: { RouterLink: true } },
    });

    await flush();

    expect(wrapper.text()).toContain(en['kb.suggestions.failed']);
    expect(wrapper.text()).not.toContain(en['kb.suggestions.empty']);
  });

  it('says it in Arabic too', async () => {
    vi.mocked(fetchSuggestions).mockResolvedValue([]);

    const wrapper = mount(SuggestionPanel, {
      props: { ticketId: 1 },
      global: { plugins: [i18n('ar')], stubs: { RouterLink: true } },
    });

    await flush();

    expect(wrapper.text()).toContain(ar['kb.suggestions.empty']);
  });
});

describe('search results say when nothing matched (FR-024)', () => {
  it('offers what to try next rather than a bare absence', () => {
    const wrapper = mount(ResultList, {
      props: { result: { items: [], otherLanguage: null }, searching: false, searched: true },
      global: { plugins: [i18n()] },
    });

    expect(wrapper.text()).toContain(en['kb.search.empty.title']);
    // The hint is the difference between an answer and a shrug.
    expect(wrapper.text()).toContain(en['kb.search.empty.hint']);
  });

  it('renders NOTHING before a search has been run', () => {
    // An idle search box must not claim nothing matched. The reader has not
    // asked anything yet.
    const wrapper = mount(ResultList, {
      props: { result: null, searching: false, searched: false },
      global: { plugins: [i18n()] },
    });

    expect(wrapper.text()).not.toContain(en['kb.search.empty.title']);
  });

  it('shows a searching state rather than an empty one while in flight', () => {
    // Otherwise the reader is told "nothing matched" for a moment, every time
    // they type — which reads as the search failing repeatedly.
    const wrapper = mount(ResultList, {
      props: { result: null, searching: true, searched: false },
      global: { plugins: [i18n()] },
    });

    expect(wrapper.text()).toContain(en['kb.search.searching']);
    expect(wrapper.text()).not.toContain(en['kb.search.empty.title']);
  });
});

describe('the cross-language offer is a CONTROL, not a substitution (FR-029)', () => {
  it('renders a button naming the count, and none of the other-language articles', () => {
    const wrapper = mount(ResultList, {
      props: {
        result: { items: [], otherLanguage: { lang: 'ar', count: 3 } },
        searching: false,
        searched: true,
      },
      global: { plugins: [i18n()] },
    });

    const button = wrapper.find('button');

    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('3');
    // A control, not results. Being handed content in a language you did not
    // ask for, unlabelled, is what FR-005a exists to prevent.
    expect(wrapper.findAll('li')).toHaveLength(0);
  });

  it('emits the language change rather than switching for the reader', () => {
    const wrapper = mount(ResultList, {
      props: {
        result: { items: [], otherLanguage: { lang: 'ar', count: 3 } },
        searching: false,
        searched: true,
      },
      global: { plugins: [i18n()] },
    });

    wrapper.find('button').trigger('click');

    expect(wrapper.emitted('switch-language')).toEqual([['ar']]);
  });
});
