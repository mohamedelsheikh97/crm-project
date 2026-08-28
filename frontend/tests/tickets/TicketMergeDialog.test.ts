import { afterEach, describe, expect, it, vi } from 'vitest';

import TicketMergeDialog from '../../src/components/tickets/TicketMergeDialog.vue';
import * as ticketsService from '../../src/services/tickets.service';
import type { Ticket } from '../../src/services/tickets.service';
import { mountWithPlugins } from '../helpers/mount';

function ticket(): Ticket {
  return {
    id: 1,
    reference: 'TKT-000001',
    subject: 'Duplicate outage report',
    description: null,
    category: 'technical',
    priority: 'high',
    status: 'open',
    customer: { id: 7, displayName: 'Nile Trading', isActive: true },
    assignee: null,
    createdBy: null,
    escalationReason: null,
    mergedIntoTicketId: null,
    links: [],
    survivor: null,
    version: 2,
    createdAt: '2026-08-28T09:00:00.000Z',
    updatedAt: '2026-08-28T09:00:00.000Z',
  };
}

function stubList(): void {
  vi.spyOn(ticketsService, 'list').mockResolvedValue({
    items: [
      {
        id: 2,
        reference: 'TKT-000002',
        subject: 'Original outage report',
        category: 'technical',
        priority: 'urgent',
        status: 'open',
        customer: null,
        assignee: null,
        mergedIntoTicketId: null,
        version: 1,
        createdAt: '2026-08-28T08:00:00.000Z',
        updatedAt: '2026-08-28T08:00:00.000Z',
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A merge is permanent and irreversible, so this dialog is deliberately slower
 * than it could be.
 */
describe('TicketMergeDialog', () => {
  it('is a modal dialog with an accessible name', async () => {
    stubList();

    const wrapper = mountWithPlugins(TicketMergeDialog, {
      props: { open: true, ticket: ticket() },
      attachTo: document.body,
    });

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-labelledby')).toBeTruthy();
  });

  it('names the ticket being absorbed', async () => {
    stubList();

    const wrapper = mountWithPlugins(TicketMergeDialog, {
      props: { open: true, ticket: ticket() },
      attachTo: document.body,
    });

    expect(wrapper.text()).toContain('TKT-000001');
    expect(wrapper.text()).toContain('Duplicate outage report');
  });

  it('says plainly that the merge cannot be undone', async () => {
    stubList();

    const wrapper = mountWithPlugins(TicketMergeDialog, {
      props: { open: true, ticket: ticket() },
      attachTo: document.body,
    });

    expect(wrapper.text()).toContain('cannot be undone');
  });

  it('focuses Cancel, not the destructive confirm', async () => {
    stubList();

    const wrapper = mountWithPlugins(TicketMergeDialog, {
      props: { open: true, ticket: ticket() },
      attachTo: document.body,
    });

    // Destructive confirmation should require a deliberate move, not an
    // accidental Enter. The `immediate: true` watch is what makes this fire at
    // all for a dialog mounted already-open.
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    });

    wrapper.unmount();
  });

  it('keeps the confirm disabled until a target is chosen', async () => {
    stubList();

    const wrapper = mountWithPlugins(TicketMergeDialog, {
      props: { open: true, ticket: ticket() },
      attachTo: document.body,
    });

    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Merge permanently'));

    expect(confirm?.attributes('disabled')).toBeDefined();
  });

  it('closes on Escape', async () => {
    stubList();

    const wrapper = mountWithPlugins(TicketMergeDialog, {
      props: { open: true, ticket: ticket() },
      attachTo: document.body,
    });

    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });

    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('renders nothing at all when closed', () => {
    const wrapper = mountWithPlugins(TicketMergeDialog, {
      props: { open: false, ticket: ticket() },
    });

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
});
