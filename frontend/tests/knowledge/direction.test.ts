import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import ArticleReader from '../../src/components/knowledge/ArticleReader.vue';
import LanguageBadge from '../../src/components/knowledge/LanguageBadge.vue';
import ar from '../../src/locales/ar.json';
import en from '../../src/locales/en.json';

/**
 * THE PROBLEM NO PREVIOUS PHASE HAS HAD (FR-055, SC-010).
 *
 * Every phase so far applied direction ONCE, at the document root, and every
 * string on the page shared it. Phase 7 breaks that: under Clarifications Q3 a
 * one-language article is legitimate, so an English article read inside an
 * Arabic interface is normal rather than exceptional.
 *
 * Left to inherit RTL, that article's paragraphs render right-aligned with
 * punctuation in the wrong place. It is still technically readable, and it
 * looks broken — which is the failure mode that matters, because the reader
 * concludes the system is broken rather than that the article is in English.
 *
 * THE RULE THIS FILE ASSERTS:
 *
 *   CHROME follows the INTERFACE. Buttons, labels, navigation — the document
 *   root, exactly as before. Principle I is unchanged.
 *
 *   CONTENT follows the ARTICLE. The body carries its own `dir` and `lang`,
 *   because its direction is a property of the text. This is not the
 *   per-component direction flipping Principle I prohibits — that rule is about
 *   chrome, and this is the same argument Phase 5 made for the chat widget on a
 *   page it does not control.
 */

function i18n(locale: 'en' | 'ar' = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, ar } });
}

const ENGLISH = {
  title: 'Card reader keeps rebooting',
  body: 'The reader power-cycles when the card is inserted.',
  lang: 'en' as const,
  availableLanguages: ['en' as const],
};

const ARABIC = {
  title: 'قارئ البطاقة يعيد التشغيل',
  body: 'يعيد القارئ التشغيل عند إدخال البطاقة.',
  lang: 'ar' as const,
  availableLanguages: ['ar' as const],
};

describe('article content carries its own direction', () => {
  it('renders an ARABIC article RTL inside an ENGLISH interface', () => {
    const wrapper = mount(ArticleReader, {
      props: ARABIC,
      global: { plugins: [i18n('en')] },
    });

    const body = wrapper.find('[dir="rtl"]');

    expect(body.exists()).toBe(true);
    expect(body.attributes('lang')).toBe('ar');
    expect(wrapper.text()).toContain(ARABIC.title);
  });

  it('renders an ENGLISH article LTR inside an ARABIC interface', () => {
    // The reverse, and the one that actually happens most: an organisation
    // working in Arabic whose technical articles arrive in English.
    const wrapper = mount(ArticleReader, {
      props: ENGLISH,
      global: { plugins: [i18n('ar')] },
    });

    const body = wrapper.find('[dir="ltr"]');

    expect(body.exists()).toBe(true);
    expect(body.attributes('lang')).toBe('en');
    expect(wrapper.find('[dir="rtl"]').exists()).toBe(false);
  });

  it('marks the title with the article direction as well as the body', () => {
    // A title is content too. An Arabic heading rendered LTR breaks in exactly
    // the same way a paragraph does, and it is the first thing anybody sees.
    const wrapper = mount(ArticleReader, {
      props: ARABIC,
      global: { plugins: [i18n('en')] },
    });

    const heading = wrapper.find('h2');

    expect(heading.attributes('dir')).toBe('rtl');
    expect(heading.attributes('lang')).toBe('ar');
  });

  it('does not set a direction on the component root, only on content', () => {
    // If the root carried `dir`, the chrome around it would flip too — which is
    // precisely what Principle I forbids.
    const wrapper = mount(ArticleReader, {
      props: ARABIC,
      global: { plugins: [i18n('en')] },
    });

    expect(wrapper.attributes('dir')).toBeUndefined();
  });
});

describe('mixed content inside a body is isolated', () => {
  it('wraps paragraphs so Latin terms cannot reorder the Arabic around them', () => {
    // The hazard Phase 6's countdowns had: a Latin product name inside Arabic
    // prose drags punctuation with it under the bidirectional algorithm, and
    // the sentence comes out rearranged. `bdi` is the fix, applied rather than
    // hoped for.
    const wrapper = mount(ArticleReader, {
      props: {
        ...ARABIC,
        body: 'استخدم الأمر systemctl restart لإعادة التشغيل.',
      },
      global: { plugins: [i18n('ar')] },
    });

    expect(wrapper.findAll('bdi').length).toBeGreaterThan(0);
  });

  it('renders fenced code LTR even inside an Arabic article', () => {
    // Code is always left-to-right. An RTL code block is unreadable rather than
    // merely ugly.
    const wrapper = mount(ArticleReader, {
      props: { ...ARABIC, body: '```\nsystemctl restart reader\n```' },
      global: { plugins: [i18n('ar')] },
    });

    const code = wrapper.find('pre');

    expect(code.exists()).toBe(true);
    expect(code.attributes('dir')).toBe('ltr');
  });
});

describe('a reader is always told which language they are being handed (FR-005a)', () => {
  it('renders the badge for a one-language article', () => {
    // Under Q3 a reader WILL meet articles they cannot read. An unlabelled one
    // does not look like an English article; it looks like a page that failed
    // to load, and the reader reloads instead of finding a colleague.
    const wrapper = mount(LanguageBadge, {
      props: { languages: ['en'] },
      global: { plugins: [i18n('ar')] },
    });

    // THE LABEL IS IN THE READER'S LANGUAGE, not the article's. An Arabic
    // reader is told, in Arabic, that this article is in English — which is the
    // whole point. Naming the language in a language the reader may not read
    // would be a riddle rather than a label.
    expect(wrapper.text()).toContain(ar['kb.language.en']);
    expect(wrapper.text()).not.toContain(en['kb.language.en']);
  });

  it('names both languages when the article has both', () => {
    const wrapper = mount(LanguageBadge, {
      props: { languages: ['en', 'ar'], showing: 'ar' },
      global: { plugins: [i18n('en')] },
    });

    expect(wrapper.text()).toContain(en['kb.language.en']);
    expect(wrapper.text()).toContain(en['kb.language.ar']);
  });

  it('says so plainly when an article has no complete language yet', () => {
    // "No badge" and "badge failed to render" look identical. Saying it is more
    // use than showing nothing.
    const wrapper = mount(LanguageBadge, {
      props: { languages: [] },
      global: { plugins: [i18n('en')] },
    });

    expect(wrapper.text()).toContain(en['kb.language.none']);
  });

  it('tags each badge with the language it names', () => {
    // So a screen reader pronounces the Arabic name with an Arabic voice rather
    // than reading it as mangled English.
    const wrapper = mount(LanguageBadge, {
      props: { languages: ['ar'] },
      global: { plugins: [i18n('en')] },
    });

    expect(wrapper.find('[lang="ar"]').exists()).toBe(true);
  });
});

describe('the article body has a real heading hierarchy', () => {
  it('produces navigable headings rather than styled paragraphs', () => {
    // The difference between a document a screen-reader user can navigate and a
    // wall of text they must listen to from the top.
    const wrapper = mount(ArticleReader, {
      props: {
        ...ENGLISH,
        body: '# Before you start\nCheck the cable.\n# If that fails\nReplace the reader.',
      },
      global: { plugins: [i18n('en')] },
    });

    // h2 is the article title; the body's headings sit under it.
    expect(wrapper.findAll('h2')).toHaveLength(1);
    expect(wrapper.findAll('h3')).toHaveLength(2);
    expect(wrapper.findAll('h3')[0]!.text()).toBe('Before you start');
  });

  it('never interprets HTML in a body', () => {
    // A surface strangers read must not render markup an author typed. Vue's
    // interpolation makes stored cross-site scripting unrepresentable here.
    const wrapper = mount(ArticleReader, {
      props: { ...ENGLISH, body: '<img src=x onerror="alert(1)">' },
      global: { plugins: [i18n('en')] },
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img');
  });
});
