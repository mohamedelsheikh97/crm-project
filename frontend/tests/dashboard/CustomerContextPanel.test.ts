import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteRecordRaw } from 'vue-router';

import CustomerContextPanel from '../../src/components/tickets/CustomerContextPanel.vue';
import * as dashboardService from '../../src/services/dashboard.service';
import type { CustomerContext } from '../../src/services/dashboard.service';
import { ApiError } from '../../src/services/http';
import { mountWithPlugins } from '../helpers/mount';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: { template: '<div/>' } },
  { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div/>' } },
  { path: '/customers/:id', name: 'customer-profile', component: { template: '<div/>' } },
];

function context(overrides: Partial<CustomerContext> = {}): CustomerContext {
  return {
    customer: {
      id: 7,
      displayName: 'Nile Trading',
      company: 'Nile Trading LLC',
      isActive: true,
      contacts: [{ id: 1, kind: 'phone', value: '+20 100 123 4567', isPrimary: true }],
    },
    otherTickets: [
      { id: 51, reference: 'TKT-000051', subject: 'Invoice query', status: 'pending', priority: 'normal' },
    ],
    recentNotes: [
      {
        id: 3,
        body: 'Prefers a morning call.',
        author: { id: 2, fullName: 'Sara' },
        createdAt: '2026-08-29T09:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

async function mountPanel() {
  const wrapper = mountWithPlugins(CustomerContextPanel, { routes, props: { ticketId: 42 } });

  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();

  return wrapper;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CustomerContextPanel shows who the customer is, beside the ticket', () => {
  it('renders identity, contacts, other tickets, and recent notes from one call', async () => {
    vi.spyOn(dashboardService, 'fetchCustomerContext').mockResolvedValue(context());

    const wrapper = await mountPanel();
    const text = wrapper.text();

    expect(text).toContain('Nile Trading');
    expect(text).toContain('+20 100 123 4567');
    expect(text).toContain('TKT-000051');
    expect(text).toContain('Prefers a morning call.');

    // ONE request. Three round-trips would make "without navigating away" feel
    // like navigating away, which is the thing this phase exists to fix.
    expect(dashboardService.fetchCustomerContext).toHaveBeenCalledTimes(1);
  });

  it('marks a deactivated customer without hiding anything', async () => {
    vi.spyOn(dashboardService, 'fetchCustomerContext').mockResolvedValue(
      context({
        customer: { ...context().customer, isActive: false },
      }),
    );

    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain('This customer is deactivated');
    // Still shows who they are — the ticket remains workable (FR-016).
    expect(wrapper.text()).toContain('Nile Trading');
  });

  it('explains an empty section rather than leaving a gap', async () => {
    vi.spyOn(dashboardService, 'fetchCustomerContext').mockResolvedValue(
      context({ otherTickets: [], recentNotes: [] }),
    );

    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain('No other tickets');
    expect(wrapper.text()).toContain('No notes yet');
  });
});

/**
 * FR-018. The panel is an ENHANCEMENT, not a gate. A caller without
 * `customers:view` gets a 403 here, and the correct response is silence: the
 * ticket beside it is fully workable, so an error banner would report a problem
 * the agent does not have.
 */
describe('CustomerContextPanel is withheld, not broken, without permission', () => {
  it('renders nothing at all on a 403', async () => {
    vi.spyOn(dashboardService, 'fetchCustomerContext').mockRejectedValue(
      new ApiError(403, 'FORBIDDEN', 'Forbidden'),
    );

    const wrapper = await mountPanel();

    expect(wrapper.find('aside').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  it('shows no error message on a 403', async () => {
    vi.spyOn(dashboardService, 'fetchCustomerContext').mockRejectedValue(
      new ApiError(403, 'FORBIDDEN', 'Forbidden'),
    );

    const wrapper = await mountPanel();

    expect(wrapper.text()).not.toContain('permission');
    expect(wrapper.text()).not.toContain('Forbidden');
  });

  it('degrades quietly on any other failure too', async () => {
    // The ticket screen around this must keep working whatever happens here.
    vi.spyOn(dashboardService, 'fetchCustomerContext').mockRejectedValue(
      new ApiError(500, 'INTERNAL_ERROR', 'Boom'),
    );

    const wrapper = await mountPanel();

    expect(wrapper.text()).not.toContain('Boom');
  });
});
