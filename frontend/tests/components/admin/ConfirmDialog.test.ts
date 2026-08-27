import { describe, expect, it } from 'vitest';

import ConfirmDialog from '../../../src/components/admin/ConfirmDialog.vue';
import { mountWithPlugins } from '../../helpers/mount';

const props = {
  open: true,
  titleKey: 'users.deactivate.title',
  messageKey: 'users.deactivate.message',
  confirmLabel: 'Deactivate Ada Lovelace',
};

describe('ConfirmDialog', () => {
  it('is a modal dialog with an accessible name', () => {
    const wrapper = mountWithPlugins(ConfirmDialog, { props, attachTo: document.body });

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-labelledby')).toBeTruthy();
  });

  it('states the specific consequence rather than "OK"', () => {
    const wrapper = mountWithPlugins(ConfirmDialog, { props, attachTo: document.body });

    expect(wrapper.text()).toContain('Deactivate Ada Lovelace');
    expect(wrapper.text()).not.toContain('OK');
  });

  it('surfaces a server refusal inside the dialog rather than swallowing it', () => {
    const wrapper = mountWithPlugins(ConfirmDialog, {
      props: { ...props, error: 'This would leave the system with no administrator.' },
      attachTo: document.body,
    });

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('no administrator');
  });

  it('emits cancel on Escape', async () => {
    const wrapper = mountWithPlugins(ConfirmDialog, { props, attachTo: document.body });

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });

    expect(wrapper.emitted('cancel')).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    const wrapper = mountWithPlugins(ConfirmDialog, { props: { ...props, open: false } });

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
});
