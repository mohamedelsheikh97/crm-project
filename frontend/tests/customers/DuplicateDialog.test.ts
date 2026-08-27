import { describe, expect, it } from 'vitest';

import DuplicateDialog from '../../src/components/customers/DuplicateDialog.vue';
import type { DuplicateMatch } from '../../src/services/customers.service';
import { mountWithPlugins } from '../helpers/mount';

function match(overrides: Partial<DuplicateMatch['customer']> = {}): DuplicateMatch {
  return {
    matchedOn: 'phone',
    matchedValue: '+201001234567',
    customer: {
      id: 42,
      displayName: 'Ahmed Hassan',
      company: 'Nile Trading',
      isActive: true,
      primaryPhone: { raw: '+20 100 123 4567', normalised: '+201001234567' },
      primaryEmail: null,
      ...overrides,
    },
  };
}

/**
 * The dialog PLAN.md's Definition of done rests on. It must be impossible to
 * click past without noticing, and equally must not block a legitimate save.
 */
describe('DuplicateDialog', () => {
  it('is a modal dialog with an accessible name', () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: true, matches: [match()] },
      attachTo: document.body,
    });

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-labelledby')).toBeTruthy();
  });

  it('names which detail matched and whose record it is', () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: true, matches: [match()] },
      attachTo: document.body,
    });

    expect(wrapper.text()).toContain('Ahmed Hassan');
    // The raw value, never the normalised form.
    expect(wrapper.text()).toContain('+20 100 123 4567');
    expect(wrapper.text()).not.toContain('+201001234567');
  });

  it('shows EVERY match, not just the first', () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: {
        open: true,
        matches: [
          match(),
          { ...match({ id: 43, displayName: 'Fatima Ali' }), matchedOn: 'email' as const },
        ],
      },
      attachTo: document.body,
    });

    expect(wrapper.text()).toContain('Ahmed Hassan');
    expect(wrapper.text()).toContain('Fatima Ali');
  });

  it('labels a deactivated match, so it does not look like a stranger', () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: true, matches: [match({ isActive: false })] },
      attachTo: document.body,
    });

    expect(wrapper.text()).toContain('deactivated');
  });

  it('does NOT focus "create anyway" — the reflex hazard this dialog guards', async () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: true, matches: [match()] },
      attachTo: document.body,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const focused = (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '';
    wrapper.unmount();

    // Someone dismissing dialogs on autopilot must not create a duplicate by
    // reflex (contracts/customer-ui.md).
    expect(focused).not.toContain('create anyway');
    expect(focused).toContain('Open the existing customer');
  });

  it('emits open-existing with the matched customer id', async () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: true, matches: [match()] },
      attachTo: document.body,
    });

    await wrapper.findAll('button')[0]!.trigger('click');

    expect(wrapper.emitted('open-existing')?.[0]).toEqual([42]);
  });

  it('still allows proceeding — a shared household phone is legitimate', async () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: true, matches: [match()] },
      attachTo: document.body,
    });

    const proceed = wrapper
      .findAll('button')
      .find((button) => button.text().includes('create anyway'));

    expect(proceed).toBeDefined();
    await proceed!.trigger('click');

    expect(wrapper.emitted('proceed')).toBeTruthy();
  });

  it('emits cancel on Escape', async () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: true, matches: [match()] },
      attachTo: document.body,
    });

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });

    expect(wrapper.emitted('cancel')).toBeTruthy();
  });

  it('uses edit wording when an existing record is being changed', () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: true, matches: [match()], editing: true },
      attachTo: document.body,
    });

    expect(wrapper.text()).toContain('save anyway');
  });

  it('renders nothing when closed', () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: false, matches: [match()] },
    });

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('renders in Arabic', () => {
    const wrapper = mountWithPlugins(DuplicateDialog, {
      props: { open: true, matches: [match()] },
      locale: 'ar',
      attachTo: document.body,
    });

    expect(wrapper.text()).toContain('فتح العميل الموجود');
  });
});
