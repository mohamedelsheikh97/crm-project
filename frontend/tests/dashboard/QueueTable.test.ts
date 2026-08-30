import { describe, expect, it } from 'vitest';
import type { RouteRecordRaw } from 'vue-router';

import QueueTable from '../../src/components/dashboard/QueueTable.vue';
import type { QueueItem } from '../../src/services/dashboard.service';
import { mountWithPlugins } from '../helpers/mount';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: { template: '<div/>' } },
  { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div/>' } },
];

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 1,
    reference: 'TKT-000001',
    subject: 'Cannot sign in',
    customer: { id: 7, displayName: 'Nile Trading', isActive: true },
    status: 'open',
    priority: 'high',
    dueAt: null,
    isOverdue: false,
    waitingSince: '2026-08-28T09:00:00.000Z',
    ...overrides,
  };
}

function mountTable(props: Partial<InstanceType<typeof QueueTable>['$props']> = {}) {
  return mountWithPlugins(QueueTable, {
    routes,
    props: {
      items: [item()],
      loading: false,
      sort: 'priority',
      direction: 'desc',
      hasFilters: false,
      ...props,
    },
  });
}

describe('QueueTable — the two empty states', () => {
  /**
   * "You have nothing to do" and "your filter hid everything" are not the same
   * news. Showing the wrong one sends an agent looking for work that is right
   * in front of them, which is why these are separate messages rather than one
   * generic "no results".
   */
  it('says the queue is empty when nothing is filtered', () => {
    const wrapper = mountTable({ items: [], hasFilters: false });

    expect(wrapper.text()).toContain('Your queue is empty');
    expect(wrapper.text()).not.toContain('No tickets match your filters');
    // No point offering to clear filters that are not set.
    expect(wrapper.text()).not.toContain('Clear filters');
  });

  it('says the filter matched nothing, and offers to clear it', async () => {
    const wrapper = mountTable({ items: [], hasFilters: true });

    expect(wrapper.text()).toContain('No tickets match your filters');
    expect(wrapper.text()).not.toContain('Your queue is empty');

    const clear = wrapper.findAll('button').find((b) => b.text() === 'Clear filters');
    expect(clear).toBeDefined();

    await clear!.trigger('click');
    expect(wrapper.emitted('clear-filters')).toHaveLength(1);
  });

  it('shows neither empty state while loading', () => {
    const wrapper = mountTable({ items: [], loading: true, hasFilters: true });

    expect(wrapper.text()).not.toContain('No tickets match your filters');
    expect(wrapper.text()).not.toContain('Your queue is empty');
  });
});

describe('QueueTable — overdue is never colour alone (FR-021, FR-084)', () => {
  it('renders the word "overdue" for a late ticket, not just a tint', () => {
    // The regression this guards: styling the row red and calling it done.
    // Greyscale, colour-blindness, and screen readers all lose that; none of
    // them lose the word.
    const wrapper = mountTable({
      items: [item({ dueAt: '2026-08-01T09:00:00.000Z', isOverdue: true })],
    });

    expect(wrapper.text()).toContain('overdue');
  });

  it('says "no due date" rather than leaving the cell blank', () => {
    const wrapper = mountTable({ items: [item({ dueAt: null })] });

    expect(wrapper.text()).toContain('No due date');
  });

  it('does not mark a dated but not-yet-late ticket as overdue', () => {
    const wrapper = mountTable({
      items: [item({ dueAt: '2099-01-01T09:00:00.000Z', isOverdue: false })],
    });

    expect(wrapper.text()).not.toContain('overdue');
  });
});

describe('QueueTable — sorting', () => {
  it('emits the field when a sortable header is activated', async () => {
    const wrapper = mountTable();

    const header = wrapper.findAll('button').find((b) => b.text().includes('Priority'));
    await header!.trigger('click');

    expect(wrapper.emitted('sort')?.[0]).toEqual(['priority']);
  });

  it('announces the sorted column and direction to assistive technology', () => {
    // Sorting must not be a visual-only affordance: an arrow glyph tells a
    // sighted user which column is active and tells a screen reader nothing.
    const wrapper = mountTable({ sort: 'dueAt', direction: 'asc' });

    const sorted = wrapper.findAll('th').find((th) => th.attributes('aria-sort') === 'ascending');

    expect(sorted?.text()).toContain('Due');
  });

  it('marks unsorted sortable columns as sortable rather than omitting the state', () => {
    const wrapper = mountTable({ sort: 'priority', direction: 'desc' });

    const none = wrapper.findAll('th').filter((th) => th.attributes('aria-sort') === 'none');

    expect(none.length).toBeGreaterThan(0);
  });

  it('gives non-sortable columns no aria-sort at all', () => {
    const wrapper = mountTable();

    const reference = wrapper.findAll('th').find((th) => th.text() === 'Reference');

    expect(reference?.attributes('aria-sort')).toBeUndefined();
  });
});

describe('QueueTable — what it deliberately does not offer', () => {
  it('renders no assign or claim control', () => {
    // Phase 3 fixed assignment as Supervisor-only and stated that this
    // dashboard is read-only with respect to it (FR-012). The absence is the
    // requirement.
    const wrapper = mountTable();
    const labels = wrapper.findAll('button').map((b) => b.text().toLowerCase());

    expect(labels.some((label) => label.includes('assign') || label.includes('claim'))).toBe(false);
  });
});

describe('QueueTable — Arabic', () => {
  it('renders the same rows with translated headers', () => {
    const wrapper = mountWithPlugins(QueueTable, {
      routes,
      locale: 'ar',
      props: {
        items: [item({ dueAt: '2026-08-01T09:00:00.000Z', isOverdue: true })],
        loading: false,
        sort: 'priority',
        direction: 'desc',
        hasFilters: false,
      },
    });

    // No untranslated key leaks through, and the overdue marker is present in
    // Arabic too.
    expect(wrapper.text()).not.toContain('dashboard.column');
    expect(wrapper.text()).toContain('متأخرة');
  });
});
