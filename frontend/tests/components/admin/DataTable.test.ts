import { describe, expect, it } from 'vitest';

import DataTable from '../../../src/components/admin/DataTable.vue';
import { mountWithPlugins } from '../../helpers/mount';

const columns = [
  { key: 'fullName', labelKey: 'users.column.name' },
  { key: 'email', labelKey: 'users.column.email' },
];

const rows = [{ id: 1, fullName: 'Ada Lovelace', email: 'ada@test.local' }];

describe('DataTable', () => {
  it('renders a real table with a caption and column scopes', () => {
    const wrapper = mountWithPlugins(DataTable, {
      props: { columns, rows, captionKey: 'users.caption' },
    });

    // Not a grid of divs: screen readers navigate by row and column, and that
    // is free only if the markup is a table (contracts/admin-ui.md).
    expect(wrapper.find('table').exists()).toBe(true);
    expect(wrapper.find('caption').exists()).toBe(true);
    expect(wrapper.findAll('th[scope="col"]')).toHaveLength(2);
  });

  it('marks the region busy while loading', () => {
    const wrapper = mountWithPlugins(DataTable, {
      props: { columns, rows: [], captionKey: 'users.caption', loading: true },
    });

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true);
  });

  it('shows an empty state rather than a bare empty table', () => {
    const wrapper = mountWithPlugins(DataTable, {
      props: { columns, rows: [], captionKey: 'users.caption' },
    });

    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.text()).toContain('Nothing to show');
  });

  it('translates headers rather than printing keys', () => {
    const wrapper = mountWithPlugins(DataTable, {
      props: { columns, rows, captionKey: 'users.caption' },
    });

    expect(wrapper.text()).toContain('Name');
    expect(wrapper.text()).not.toContain('users.column.name');
  });

  it('renders Arabic when the locale is Arabic', () => {
    const wrapper = mountWithPlugins(DataTable, {
      props: { columns, rows, captionKey: 'users.caption' },
      locale: 'ar',
    });

    expect(wrapper.text()).toContain('الاسم');
  });
});
