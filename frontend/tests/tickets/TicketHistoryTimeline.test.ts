import { afterEach, describe, expect, it, vi } from 'vitest';

import TicketHistoryTimeline from '../../src/components/tickets/TicketHistoryTimeline.vue';
import * as ticketsService from '../../src/services/tickets.service';
import type { HistoryEntry } from '../../src/services/tickets.service';
import { mountWithPlugins } from '../helpers/mount';

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    event: 'ticket.created',
    actorName: 'Omar Said',
    field: null,
    previousValue: null,
    newValue: null,
    note: null,
    createdAt: '2026-08-28T09:00:00.000Z',
    ticketId: 1,
    ...overrides,
  };
}

function stub(items: HistoryEntry[]): void {
  vi.spyOn(ticketsService, 'history').mockResolvedValue({
    items,
    page: 1,
    pageSize: 200,
    total: items.length,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TicketHistoryTimeline', () => {
  it('is an ordered list, because it is an ordered list of events', async () => {
    stub([entry(), entry({ id: 2, event: 'ticket.status.changed' })]);

    const wrapper = mountWithPlugins(TicketHistoryTimeline, {
      props: { ticketId: 1, ticketReference: 'TKT-000001' },
    });

    await vi.waitFor(() => expect(wrapper.find('ol').exists()).toBe(true));
    expect(wrapper.findAll('li')).toHaveLength(2);
  });

  it('renders in the order the server sent — oldest first', async () => {
    stub([
      entry({ id: 1, event: 'ticket.created' }),
      entry({
        id: 2,
        event: 'ticket.status.changed',
        field: 'status',
        previousValue: 'new',
        newValue: 'open',
      }),
    ]);

    const wrapper = mountWithPlugins(TicketHistoryTimeline, {
      props: { ticketId: 1, ticketReference: 'TKT-000001' },
    });

    await vi.waitFor(() => expect(wrapper.findAll('li').length).toBe(2));

    const items = wrapper.findAll('li');
    expect(items[0].text()).toContain('Ticket raised');
    expect(items[1].text()).toContain('Status changed');
  });

  it('renders a status value as a LABEL, not as the stored key', async () => {
    stub([
      entry({
        id: 2,
        event: 'ticket.status.changed',
        field: 'status',
        previousValue: 'new',
        newValue: 'open',
      }),
    ]);

    const wrapper = mountWithPlugins(TicketHistoryTimeline, {
      props: { ticketId: 1, ticketReference: 'TKT-000001' },
    });

    await vi.waitFor(() => expect(wrapper.findAll('li').length).toBe(1));

    // Showing `new → open` in an Arabic interface would be showing the
    // database to the user.
    expect(wrapper.text()).toContain('New');
    expect(wrapper.text()).toContain('Open');
  });

  it('renders a priority value through i18n too', async () => {
    stub([
      entry({
        id: 3,
        event: 'ticket.updated',
        field: 'priority',
        previousValue: 'low',
        newValue: 'urgent',
      }),
    ]);

    const wrapper = mountWithPlugins(TicketHistoryTimeline, {
      props: { ticketId: 1, ticketReference: 'TKT-000001' },
    });

    await vi.waitFor(() => expect(wrapper.findAll('li').length).toBe(1));

    expect(wrapper.text()).toContain('Urgent');
  });

  it('labels an entry that came from an absorbed ticket', async () => {
    stub([entry({ id: 4, ticketId: 99, event: 'ticket.updated' })]);

    const wrapper = mountWithPlugins(TicketHistoryTimeline, {
      props: { ticketId: 1, ticketReference: 'TKT-000001' },
    });

    await vi.waitFor(() => expect(wrapper.findAll('li').length).toBe(1));

    // A spanning history is readable only if each entry says where it came
    // from — that provenance is the reason merge does not rewrite ticket_id.
    expect(wrapper.text()).toContain('From a merged ticket');
  });

  it('does not label an entry that belongs to this ticket', async () => {
    stub([entry({ id: 5, ticketId: 1 })]);

    const wrapper = mountWithPlugins(TicketHistoryTimeline, {
      props: { ticketId: 1, ticketReference: 'TKT-000001' },
    });

    await vi.waitFor(() => expect(wrapper.findAll('li').length).toBe(1));

    expect(wrapper.text()).not.toContain('From a merged ticket');
  });

  it('says so when there is nothing yet', async () => {
    stub([]);

    const wrapper = mountWithPlugins(TicketHistoryTimeline, {
      props: { ticketId: 1, ticketReference: 'TKT-000001' },
    });

    await vi.waitFor(() => expect(wrapper.text()).toContain('Nothing has happened yet'));
  });
});
