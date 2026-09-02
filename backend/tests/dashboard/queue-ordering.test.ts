import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TICKET_PRIORITIES } from '../../src/tickets/taxonomy.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedTicket } from '../tickets/helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

const HOUR = 3_600_000;

describe('queue ordering — priority (FR-006)', () => {
  it('orders by urgency rank, not alphabetically', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    // Seeded in an order that is neither the answer nor its reverse, so a
    // "sort" that is really insertion order cannot pass by luck.
    for (const priority of ['normal', 'urgent', 'low', 'high'] as const) {
      await seedTicket({ customer, createdBy: user, assignee: user, status: 'open', priority });
    }

    const response = await agent.get('/api/dashboard/queue?sort=priority');

    expect(response.body.items.map((item: { priority: string }) => item.priority)).toEqual([
      'urgent',
      'high',
      'normal',
      'low',
    ]);
  });

  it('reads its ranking from taxonomy.ts rather than a second list', async () => {
    // The regression this guards: a priority added to the taxonomy but not to a
    // hardcoded sort list would order at the bottom regardless of its rank, and
    // nothing else would notice. Deriving the expectation from the declaration
    // means this test breaks the moment the queue stops reading it.
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    for (const priority of TICKET_PRIORITIES) {
      await seedTicket({
        customer,
        createdBy: user,
        assignee: user,
        status: 'open',
        priority: priority.key,
      });
    }

    const expected = [...TICKET_PRIORITIES]
      .sort((a, b) => b.rank - a.rank)
      .map((priority) => priority.key);

    const response = await agent.get('/api/dashboard/queue?sort=priority&direction=desc');

    expect(response.body.items.map((item: { priority: string }) => item.priority)).toEqual(
      expected,
    );
  });
});

describe('queue ordering — due date (FR-023)', () => {
  /**
   * The behaviour this pins is easy to get wrong and easy to miss: MySQL sorts
   * NULL first ascending and last descending. Without the leading `IS NULL`
   * expression, tickets with no due date drift from one end of the queue to the
   * other as the agent toggles direction — each sort individually correct, the
   * pair of them incoherent.
   */
  async function seedMixedDueDates() {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();
    const now = Date.now();

    const soon = await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'open',
      subject: 'soon',
      dueAt: new Date(now + HOUR),
    });
    const later = await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'open',
      subject: 'later',
      dueAt: new Date(now + 48 * HOUR),
    });
    const undated = await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'open',
      subject: 'undated',
      dueAt: null,
    });

    return { agent, soon, later, undated };
  }

  it('puts undated tickets last when sorting ascending', async () => {
    const { agent, soon, later, undated } = await seedMixedDueDates();

    const response = await agent.get('/api/dashboard/queue?sort=dueAt&direction=asc');

    expect(response.body.items.map((item: { id: number }) => item.id)).toEqual([
      soon.id,
      later.id,
      undated.id,
    ]);
  });

  it('keeps undated tickets last when sorting descending', async () => {
    const { agent, soon, later, undated } = await seedMixedDueDates();

    const response = await agent.get('/api/dashboard/queue?sort=dueAt&direction=desc');

    // The DATED tickets reverse; the undated one does not move. That asymmetry
    // is the requirement.
    expect(response.body.items.map((item: { id: number }) => item.id)).toEqual([
      later.id,
      soon.id,
      undated.id,
    ]);
  });

  it('never reports an undated ticket as overdue', async () => {
    const { agent, undated } = await seedMixedDueDates();

    const response = await agent.get('/api/dashboard/queue');
    const item = response.body.items.find((row: { id: number }) => row.id === undated.id);

    expect(item.dueAt).toBeNull();
    expect(item.isOverdue).toBe(false);
  });
});

describe('queue ordering and filtering apply across the whole queue (FR-008)', () => {
  it('sorts before paging, not within the page', async () => {
    // The bug this catches: sorting the loaded page rather than the query. With
    // page size 1, a client-side sort would return whichever ticket happened to
    // be first in insertion order, not the most urgent overall.
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'open',
      priority: 'low',
    });
    await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'open',
      priority: 'urgent',
    });

    const response = await agent.get('/api/dashboard/queue?sort=priority&pageSize=1');

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].priority).toBe('urgent');
    expect(response.body.total).toBe(2);
  });

  it('filters by status and priority together', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'open',
      priority: 'urgent',
    });
    await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'pending',
      priority: 'urgent',
    });
    await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'open',
      priority: 'low',
    });

    const response = await agent.get('/api/dashboard/queue?status=open&priority=urgent');

    expect(response.body.total).toBe(1);
    expect(response.body.items[0].status).toBe('open');
    expect(response.body.items[0].priority).toBe('urgent');
  });

  it('filters to overdue only, and excludes Closed from it (FR-027)', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();
    const past = new Date(Date.now() - HOUR);

    const overdue = await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'open',
      dueAt: past,
    });
    // Past its date, but finished. Reporting it as late is noise about work
    // nobody is going to do.
    await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'closed',
      dueAt: past,
    });
    await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: 'open',
      dueAt: new Date(Date.now() + HOUR),
    });

    const response = await agent.get('/api/dashboard/queue?overdue=true&includeClosed=true');

    expect(response.body.total).toBe(1);
    expect(response.body.items[0].id).toBe(overdue.id);
    expect(response.body.items[0].isOverdue).toBe(true);
  });
});
