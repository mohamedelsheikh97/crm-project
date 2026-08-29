import { afterEach, describe, expect, it, vi } from 'vitest';

import TicketTransitionMenu from '../../src/components/tickets/TicketTransitionMenu.vue';
import * as ticketsService from '../../src/services/tickets.service';
import type { Ticket, TicketStatus } from '../../src/services/tickets.service';
import { mountWithPlugins } from '../helpers/mount';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    reference: 'TKT-000001',
    subject: 'Cannot sign in',
    description: null,
    category: 'technical',
    priority: 'high',
    status: 'resolved',
    customer: { id: 7, displayName: 'Nile Trading', isActive: true },
    assignee: null,
    createdBy: null,
    escalationReason: null,
    mergedIntoTicketId: null,
    links: [],
    survivor: null,
    version: 3,
    createdAt: '2026-08-28T09:00:00.000Z',
    updatedAt: '2026-08-28T09:00:00.000Z',
    ...overrides,
  };
}

function stubTransitions(available: TicketStatus[]): void {
  vi.spyOn(ticketsService, 'transitions').mockResolvedValue({
    status: 'resolved',
    transitions: available,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The component holds NO copy of the lifecycle table. These tests are the
 * guard on that: what renders is exactly what the server returned, and nothing
 * the server withheld.
 */
describe('TicketTransitionMenu', () => {
  it('renders only the moves the server returned', async () => {
    stubTransitions(['open', 'closed']);

    const wrapper = mountWithPlugins(TicketTransitionMenu, { props: { ticket: ticket() } });
    await vi.waitFor(() => expect(wrapper.findAll('button').length).toBeGreaterThan(0));

    const labels = wrapper.findAll('button').map((button) => button.text());

    expect(labels).toContain('Open');
    expect(labels).toContain('Close');
  });

  it('renders nothing extra when the server withholds a move', async () => {
    // The `closed` edge exists in the table but not for this caller. Offering
    // it would be the interface promising authority it cannot deliver.
    stubTransitions(['open']);

    const wrapper = mountWithPlugins(TicketTransitionMenu, { props: { ticket: ticket() } });
    await vi.waitFor(() => expect(wrapper.findAll('button').length).toBeGreaterThan(0));

    const labels = wrapper.findAll('button').map((button) => button.text());

    expect(labels).toEqual(['Open']);
    expect(labels).not.toContain('Close');
  });

  it('says so plainly when no move is available', async () => {
    stubTransitions([]);

    const wrapper = mountWithPlugins(TicketTransitionMenu, {
      props: { ticket: ticket({ mergedIntoTicketId: 9 }) },
    });

    await vi.waitFor(() => expect(wrapper.text()).toContain('No actions are available'));
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('asks for a reason before escalating rather than firing straight away', async () => {
    stubTransitions(['escalated']);
    const send = vi.spyOn(ticketsService, 'transition');

    const wrapper = mountWithPlugins(TicketTransitionMenu, {
      props: { ticket: ticket({ status: 'open' }) },
    });

    await vi.waitFor(() => expect(wrapper.findAll('button').length).toBeGreaterThan(0));
    await wrapper.find('button').trigger('click');

    // An escalation with no reason is a status nobody downstream can act on.
    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('loads on first render, not only on a later change', async () => {
    const spy = vi.spyOn(ticketsService, 'transitions').mockResolvedValue({
      status: 'resolved',
      transitions: ['open'],
    });

    mountWithPlugins(TicketTransitionMenu, { props: { ticket: ticket() } });

    // A plain watch fires only on CHANGE, which would leave a component mounted
    // with an already-loaded ticket showing nothing at all.
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(1));
  });
});
