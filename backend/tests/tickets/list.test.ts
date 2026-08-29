import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { User } from '../../src/models/index.js';
import { toReference } from '../../src/tickets/reference.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs, createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedTicket } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('listing tickets (US1)', () => {
  it('pages the results', async () => {
    const { user, agent } = await agentAs('agent');

    for (let index = 0; index < 5; index += 1) {
      await seedTicket({ createdBy: user });
    }

    const response = await agent.get('/api/tickets?page=1&pageSize=2');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.total).toBe(5);
    expect(response.body.pageSize).toBe(2);
  });

  it('finds a ticket by its reference (FR-024)', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user });
    await seedTicket({ createdBy: user });

    const response = await agent.get(`/api/tickets?q=${toReference(ticket.id)}`);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].id).toBe(ticket.id);
  });

  it('finds a ticket by its bare id too', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user });

    // The reference is a presentation of the id; refusing to recognise the id
    // itself would be pedantry.
    const response = await agent.get(`/api/tickets?q=${ticket.id}`);

    expect(response.body.items.some((item: { id: number }) => item.id === ticket.id)).toBe(true);
  });

  it('matches a subject case-insensitively', async () => {
    const { user, agent } = await agentAs('agent');
    await seedTicket({ createdBy: user, subject: 'Printer Jam In Reception' });

    const response = await agent.get('/api/tickets?q=printer jam');

    expect(response.body.items).toHaveLength(1);
  });

  it('matches an Arabic subject', async () => {
    const { user, agent } = await agentAs('agent');
    await seedTicket({ createdBy: user, subject: 'مشكلة في الطابعة' });

    const response = await agent.get('/api/tickets?q=الطابعة');

    // No special handling: utf8mb4_0900_ai_ci is accent- and case-insensitive.
    expect(response.body.items).toHaveLength(1);
  });

  it('filters by repeated status values', async () => {
    const { user, agent } = await agentAs('agent');
    await seedTicket({ createdBy: user, status: 'open' });
    await seedTicket({ createdBy: user, status: 'pending' });
    await seedTicket({ createdBy: user, status: 'resolved' });

    const response = await agent.get('/api/tickets?status=open&status=pending');

    expect(response.body.items).toHaveLength(2);
  });

  it('filters by priority and by category', async () => {
    const { user, agent } = await agentAs('agent');
    await seedTicket({ createdBy: user, priority: 'urgent', category: 'billing' });
    await seedTicket({ createdBy: user, priority: 'low', category: 'general' });

    expect((await agent.get('/api/tickets?priority=urgent')).body.items).toHaveLength(1);
    expect((await agent.get('/api/tickets?category=billing')).body.items).toHaveLength(1);
  });

  it('filters by assignee, and by the unassigned pool (FR-027)', async () => {
    const { user, agent } = await agentAs('agent');
    const other: User = await createTestUser({ roleKey: 'agent' });

    await seedTicket({ createdBy: user, assignee: other });
    await seedTicket({ createdBy: user, assignee: null });
    await seedTicket({ createdBy: user, assignee: null });

    expect((await agent.get(`/api/tickets?assigneeId=${other.id}`)).body.items).toHaveLength(1);
    expect((await agent.get('/api/tickets?assigneeId=unassigned')).body.items).toHaveLength(2);
  });

  it('filters by customer (FR-025)', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    await seedTicket({ createdBy: user, customer });
    await seedTicket({ createdBy: user });

    const response = await agent.get(`/api/tickets?customerId=${customer.id}`);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].customer.id).toBe(customer.id);
  });

  it('sorts by priority RANK, not alphabetically', async () => {
    const { user, agent } = await agentAs('agent');
    await seedTicket({ createdBy: user, priority: 'normal' });
    await seedTicket({ createdBy: user, priority: 'urgent' });
    await seedTicket({ createdBy: user, priority: 'low' });

    const response = await agent.get('/api/tickets?sort=-priority');
    const order = response.body.items.map((item: { priority: string }) => item.priority);

    // Alphabetically, 'urgent' sorts below 'normal' — exactly backwards. This
    // is the assertion that catches a naive ORDER BY priority.
    expect(order).toEqual(['urgent', 'normal', 'low']);
  });

  it('excludes merged tickets by default and includes them on request (FR-044)', async () => {
    const { user, agent } = await agentAs('supervisor');
    const customer = await seedCustomer();
    const survivor = await seedTicket({ createdBy: user, customer });
    await seedTicket({ createdBy: user, customer, mergedInto: survivor });

    expect((await agent.get('/api/tickets')).body.items).toHaveLength(1);
    expect((await agent.get('/api/tickets?includeMerged=true')).body.items).toHaveLength(2);
  });

  it('returns each ticket with its derived reference', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await seedTicket({ createdBy: user });

    const response = await agent.get('/api/tickets');

    expect(response.body.items[0].reference).toBe(toReference(ticket.id));
  });

  it('treats a non-numeric id as a route that does not exist', async () => {
    const { agent } = await agentAs('agent');

    // Without the guard this reaches the service and produces a 500.
    const response = await agent.get('/api/tickets/not-a-number');

    expect(response.status).toBe(404);
  });
});
