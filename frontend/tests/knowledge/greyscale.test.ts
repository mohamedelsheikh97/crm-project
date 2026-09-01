import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import SuggestionPanel from '../../src/components/knowledge/SuggestionPanel.vue';
import en from '../../src/locales/en.json';
import ar from '../../src/locales/ar.json';

vi.mock('../../src/services/knowledge.service', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../src/services/knowledge.service',
  );

  return { ...actual, fetchSuggestions: vi.fn(), detachArticle: vi.fn() };
});

const { fetchSuggestions } = await import('../../src/services/knowledge.service');

/**
 * STATUS AND ATTRIBUTION SURVIVE COLOUR BEING STRIPPED (FR-056).
 *
 * The way this requirement fails is mundane and invisible in code review:
 * somebody renders "draft" in amber and "published" in green, and the
 * distinction disappears for every colourblind user, in every printout, and on
 * every screen with the brightness turned down in a shop with a broken card
 * reader.
 *
 * The Phase 6 greyscale rule caught exactly this once already, which is why it
 * is an assertion here rather than an item on a review checklist. A screenshot
 * review by a sighted reader passes a page that fails this test.
 *
 * The pinned/suggested distinction is the sharper case in this phase. "A
 * colleague chose this" and "a rule matched a word" are different facts, and an
 * agent deciding whether to trust an article needs to tell them apart — with
 * TEXT, not a hue.
 */

function i18n(locale: 'en' | 'ar' = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, ar } });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    articleId: 1,
    slug: 'card-reader',
    title: 'Card reader keeps rebooting',
    lang: 'en',
    excerpt: 'Replace the cable.',
    categoryId: 1,
    categoryName: 'Hardware',
    score: 40,
    pinned: false,
    attachedBy: null,
    ...overrides,
  };
}

async function panel(items: Array<Record<string, unknown>>, locale: 'en' | 'ar' = 'en') {
  vi.mocked(fetchSuggestions).mockResolvedValue(items as never);

  const wrapper = mount(SuggestionPanel, {
    props: { ticketId: 1 },
    global: { plugins: [i18n(locale)], stubs: { RouterLink: true } },
  });

  await flush();

  return wrapper;
}

describe('a pinned article is distinguishable from a suggestion without colour', () => {
  it('names WHO pinned it, in words', async () => {
    const wrapper = await panel([
      suggestion({ pinned: true, attachedBy: { id: 4, fullName: 'Hala Ahmed' } }),
    ]);

    // Text, not a hue. And the person's name, because "pinned" alone does not
    // tell an agent whether to trust it.
    expect(wrapper.text()).toContain('Hala Ahmed');
  });

  it('says a RULE attached it when nobody did', async () => {
    // Null `attachedBy` is the Phase 5/6 convention for a system act. Rendering
    // it as a blank author would be worse than saying nothing — it would look
    // like a colleague whose name failed to load.
    const wrapper = await panel([suggestion({ pinned: true, attachedBy: null })]);

    expect(wrapper.text()).toContain(en['kb.suggestions.pinnedByRule']);
  });

  it('says neither for a computed suggestion', async () => {
    const wrapper = await panel([suggestion({ pinned: false })]);

    expect(wrapper.text()).not.toContain(en['kb.suggestions.pinnedByRule']);
    expect(wrapper.text()).not.toContain(en['kb.suggestions.unpin']);
  });

  it('carries a SHAPE difference as well as text', async () => {
    // Belt and braces: a border on the pinned row means the two are separable
    // at a glance without reading, and without colour.
    const pinned = await panel([suggestion({ pinned: true, attachedBy: null })]);
    const computed = await panel([suggestion({ pinned: false })]);

    expect(pinned.find('li').classes().join(' ')).toContain('border');
    expect(computed.find('li').classes().join(' ')).not.toContain('border');
  });

  it('offers unpin ONLY on a pinned entry', async () => {
    // A suggestion was never a decision. A dismiss control on one would teach
    // agents that the system remembers what they dismissed, and it does not.
    const pinned = await panel([suggestion({ pinned: true, attachedBy: null })]);
    const computed = await panel([suggestion({ pinned: false })]);

    expect(pinned.text()).toContain(en['kb.suggestions.unpin']);
    expect(computed.text()).not.toContain(en['kb.suggestions.unpin']);
  });

  it('holds in Arabic', async () => {
    const wrapper = await panel([suggestion({ pinned: true, attachedBy: null })], 'ar');

    expect(wrapper.text()).toContain(ar['kb.suggestions.pinnedByRule']);
  });
});

describe('the language badge does not depend on colour either', () => {
  it('writes the language name out rather than tinting the row', async () => {
    const wrapper = await panel([suggestion({ lang: 'ar' })]);

    expect(wrapper.text()).toContain(en['kb.language.ar']);
  });
});
