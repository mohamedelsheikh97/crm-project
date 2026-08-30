import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TemplatePicker from '../../src/components/templates/TemplatePicker.vue';
import * as templatesService from '../../src/services/templates.service';
import type { ReplyTemplate } from '../../src/services/templates.service';
import { mountWithPlugins } from '../helpers/mount';

function template(overrides: Partial<ReplyTemplate> = {}): ReplyTemplate {
  return {
    id: 1,
    titleEn: 'Password reset',
    titleAr: 'إعادة تعيين كلمة المرور',
    bodyEn: 'I have sent you a reset link.',
    bodyAr: 'أرسلت إليك رابط إعادة التعيين.',
    availableLanguages: ['en', 'ar'],
    retiredAt: null,
    createdAt: '2026-08-29T09:00:00.000Z',
    ...overrides,
  };
}

/** English only — the case FR-070 exists for. */
const ENGLISH_ONLY = template({
  id: 2,
  titleEn: 'Escalated to a specialist',
  titleAr: null,
  bodyEn: 'I have passed this to a specialist.',
  bodyAr: null,
  availableLanguages: ['en'],
});

function stubList(items: ReplyTemplate[]): void {
  vi.spyOn(templatesService, 'fetchTemplates').mockResolvedValue({
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  });
}

beforeEach(() => {
  stubList([template()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function mountPicker(locale: 'en' | 'ar' = 'en') {
  const wrapper = mountWithPlugins(TemplatePicker, { locale });

  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();

  return wrapper;
}

describe('TemplatePicker — inserting', () => {
  it('inserts the version matching the active language', async () => {
    const wrapper = await mountPicker('en');

    await wrapper.findAll('button').find((b) => b.text() === 'Insert template')!.trigger('click');

    const [, text] = wrapper.emitted('insert')![0] as [ReplyTemplate, string];
    expect(text).toBe('I have sent you a reset link.');
  });

  it('inserts the Arabic version for an Arabic agent, from the same template', async () => {
    const wrapper = await mountPicker('ar');

    await wrapper.findAll('button').find((b) => b.text() === 'إدراج قالب')!.trigger('click');

    const [, text] = wrapper.emitted('insert')![0] as [ReplyTemplate, string];
    expect(text).toBe('أرسلت إليك رابط إعادة التعيين.');
  });

  it('emits the text rather than anything locked, so the composer can edit it', async () => {
    // FR-068: a template is a starting point, never a locked message. The
    // picker hands over plain text and keeps no claim on it.
    const wrapper = await mountPicker();

    await wrapper.findAll('button').find((b) => b.text() === 'Insert template')!.trigger('click');

    const [, text] = wrapper.emitted('insert')![0] as [ReplyTemplate, string];
    expect(typeof text).toBe('string');
  });
});

/**
 * FR-070's real substance. A template that exists in only one language must be
 * offered WITH ITS LANGUAGE NAMED — silently handing an Arabic-speaking agent
 * English text is the failure this prevents.
 */
describe('TemplatePicker — single-language templates', () => {
  it('names the language when it is not the agent’s own', async () => {
    stubList([ENGLISH_ONLY]);

    const wrapper = await mountPicker('ar');

    expect(wrapper.text()).toContain('متاح بـ');
    expect(wrapper.text()).toContain('الإنجليزية');
  });

  it('still inserts it, rather than hiding it from the picker', async () => {
    stubList([ENGLISH_ONLY]);

    const wrapper = await mountPicker('ar');
    await wrapper.findAll('button').find((b) => b.text() === 'إدراج قالب')!.trigger('click');

    const [, text] = wrapper.emitted('insert')![0] as [ReplyTemplate, string];
    expect(text).toBe('I have passed this to a specialist.');
  });

  it('adds no language note when the template is in the agent’s language', async () => {
    stubList([ENGLISH_ONLY]);

    const wrapper = await mountPicker('en');

    expect(wrapper.text()).not.toContain('Only in');
  });
});

describe('TemplatePicker — finding and previewing', () => {
  it('searches on the SERVER rather than filtering a loaded list', async () => {
    const wrapper = await mountPicker();

    await wrapper.find('input[type="search"]').setValue('refund');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Bounded and searched server-side (FR-072): the picker never renders the
    // whole library, which is what keeps it usable as the library grows.
    expect(templatesService.fetchTemplates).toHaveBeenCalledWith({ q: 'refund' });
  });

  it('previews a template before it is used', async () => {
    const wrapper = await mountPicker();

    expect(wrapper.text()).not.toContain('I have sent you a reset link.');

    await wrapper.findAll('button').find((b) => b.text() === 'Password reset')!.trigger('click');

    expect(wrapper.text()).toContain('I have sent you a reset link.');
  });

  it('says so when nothing matches', async () => {
    stubList([]);

    const wrapper = await mountPicker();

    expect(wrapper.text()).toContain('No templates match');
  });
});
