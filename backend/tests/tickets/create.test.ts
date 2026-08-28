import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog, Ticket, TicketHistory } from '../../src/models/index.js';
import { toReference } from '../../src/tickets/reference.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { ticketPayload } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('creating a ticket (US1)', () => {
  it('records it against a customer and returns a reference', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const response = await agent
      .post('/api/tickets')
      .send(ticketPayload({ customerId: customer.id }));

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('new');
    expect(response.body.reference).toMatch(/^TKT-\d{6}$/);
    expect(response.body.reference).toBe(toReference(response.body.id));
    expect(response.body.customer.id).toBe(customer.id);
    expect(response.body.assignee).toBeNull();
    expect(response.body.createdBy.id).toBeGreaterThan(0);
  });

  it('gives each ticket a distinct reference', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const first = await agent.post('/api/tickets').send(ticketPayload({ customerId: customer.id }));
    const second = await agent
      .post('/api/tickets')
      .send(ticketPayload({ customerId: customer.id }));

    expect(first.body.reference).not.toBe(second.body.reference);
  });

  it('accepts an Arabic subject and description unchanged', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const subject = 'لا يمكنني تسجيل الدخول';
    const description = 'رسالة إعادة تعيين كلمة المرور لا تصل أبدًا. Product: CRM Support v2.';

    const response = await agent
      .post('/api/tickets')
      .send(ticketPayload({ customerId: customer.id, subject, description }));

    expect(response.status).toBe(201);
    // The longest free text the system has accepted so far, and a mixed
    // Arabic-and-Latin description — a common real case, since product names
    // stay Latin.
    expect(response.body.subject).toBe(subject);
    expect(response.body.description).toBe(description);
  });

  it('requires a subject, a customer, a category, and a priority (FR-006)', async () => {
    const { agent } = await agentAs('agent');

    const response = await agent.post('/api/tickets').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');

    const fields = response.body.error.details.map((detail: { field: string }) => detail.field);
    expect(fields).toContain('subject');
    expect(fields).toContain('customerId');
    expect(fields).toContain('category');
    expect(fields).toContain('priority');
  });

  it('refuses an unknown category and names the accepted values', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const response = await agent
      .post('/api/tickets')
      .send(ticketPayload({ customerId: customer.id, category: 'not-a-category' }));

    expect(response.status).toBe(400);

    const detail = response.body.error.details.find(
      (item: { field: string }) => item.field === 'category',
    );

    // The set is closed and undiscoverable otherwise; a refusal that does not
    // name it leaves the caller guessing.
    expect(detail.message).toContain('general');
    expect(detail.message).toContain('complaint');
  });

  it('refuses an unknown priority and names the accepted values', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const response = await agent
      .post('/api/tickets')
      .send(ticketPayload({ customerId: customer.id, priority: 'catastrophic' }));

    expect(response.status).toBe(400);

    const detail = response.body.error.details.find(
      (item: { field: string }) => item.field === 'priority',
    );

    expect(detail.message).toContain('urgent');
  });

  it('refuses a deactivated customer (FR-007)', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer({ isActive: false });

    const response = await agent
      .post('/api/tickets')
      .send(ticketPayload({ customerId: customer.id }));

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('CUSTOMER_INACTIVE');
  });

  it('ignores a caller-supplied status', async () => {
    const { agent } = await agentAs('supervisor');
    const customer = await seedCustomer();

    const response = await agent
      .post('/api/tickets')
      .send(ticketPayload({ customerId: customer.id, status: 'closed' }));

    // A client that could post status: 'closed' would have bypassed the entire
    // lifecycle. The field is not read on create at all.
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('new');
  });

  it('writes both a history entry and an audit entry (FR-052)', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const response = await agent
      .post('/api/tickets')
      .send(ticketPayload({ customerId: customer.id }));

    const history = await TicketHistory.findAll({ where: { ticket_id: response.body.id } });
    expect(history).toHaveLength(1);
    expect(history[0].event).toBe('ticket.created');
    expect(history[0].actor_name).not.toBe('');

    const audit = await AuditLog.findAll({ where: { action: 'ticket.created' } });
    expect(audit).toHaveLength(1);
    expect(audit[0].target_label).toBe(response.body.reference);
  });

  it('leaves nothing behind when validation fails', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer({ isActive: false });

    await agent.post('/api/tickets').send(ticketPayload({ customerId: customer.id }));

    expect(await Ticket.count()).toBe(0);
    expect(await TicketHistory.count()).toBe(0);
  });
});
