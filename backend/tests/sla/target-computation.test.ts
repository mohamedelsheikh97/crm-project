import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Ticket, TicketSla } from '../../src/models/index.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedCalendar, seedPolicy } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * FR-010 and FR-014: a ticket acquires its targets the moment it exists, and a
 * ticket matching no policy acquires NOTHING.
 *
 * The second half matters more than it looks. FR-014 is implemented as an
 * ABSENT ROW rather than a row of nulls, which is what makes "a ticket with no
 * commitment can never be reported as breaching one" structural instead of a
 * condition somebody has to remember in five different queries.
 */
describe('a ticket acquires its targets at creation (FR-010)', () => {
  it('computes both targets from the matching policy', async () => {
    const { user, agent } = await agentAs('supervisor');
    await seedCalendar();
    // Both targets comfortably longer than SLA_WARNING_LEAD_MINUTES (60).
    //
    // A CONFIGURATION HAZARD WORTH KNOWING, found by writing this test: a
    // target SHORTER THAN OR EQUAL TO the warning lead is born `at_risk`,
    // because "within the lead time of its target" is true from the moment it
    // exists. That is literally what FR-037's configurable lead means, and it
    // is not a bug — but the SEEDED urgent policy promises a 60-minute first
    // response against a 60-minute default lead, so every urgent ticket starts
    // at risk. An installation wanting otherwise lowers the lead; the
    // quickstart's "confirm the defaults" task is where that decision belongs.
    const policy = await seedPolicy({
      priority: 'urgent',
      responseMinutes: 240,
      resolutionMinutes: 480,
    });
    const customer = await seedCustomer();

    const response = await agent.post('/api/tickets').send({
      customerId: customer.id,
      subject: 'Urgent thing',
      category: 'general',
      priority: 'urgent',
    });

    expect(response.status).toBe(201);
    expect(response.body.sla).not.toBeNull();
    expect(response.body.sla.policyId).toBe(policy.id);
    expect(response.body.sla.response.targetAt).not.toBeNull();
    expect(response.body.sla.resolution.targetAt).not.toBeNull();
    expect(response.body.sla.response.state).toBe('on_track');

    // The row exists and records which policy promised what (FR-012).
    const row = await TicketSla.findByPk(response.body.id);
    expect(row?.policy_id).toBe(policy.id);
    expect(user.id).toBeGreaterThan(0);
  });

  it('drives Phase 4’s due date through the FR-028 seam (FR-024)', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    await seedPolicy({ priority: 'normal', responseMinutes: 60, resolutionMinutes: 240 });
    const customer = await seedCustomer();

    const response = await agent.post('/api/tickets').send({
      customerId: customer.id,
      subject: 'Ordinary thing',
      category: 'general',
      priority: 'normal',
    });

    const ticket = await Ticket.findByPk(response.body.id);
    const row = await TicketSla.findByPk(response.body.id);

    // The resolution target IS the due date, and the ticket says a policy put
    // it there — which is the whole of research D6.
    expect(ticket?.due_source).toBe('policy');
    expect(ticket?.due_at?.getTime()).toBe(row?.resolution_target_at?.getTime());
    expect(response.body.sla.dueSource).toBe('policy');
  });

  it('accepts a ticket that matches no policy, with NO row at all (FR-014)', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    // A policy for `urgent` only. A `low` ticket matches nothing.
    await seedPolicy({ priority: 'urgent' });
    const customer = await seedCustomer();

    const response = await agent.post('/api/tickets').send({
      customerId: customer.id,
      subject: 'Unpromised thing',
      category: 'general',
      priority: 'low',
    });

    // ACCEPTED, not refused (FR-014).
    expect(response.status).toBe(201);
    // NULL, not an object of nulls — so nothing downstream can render a
    // countdown about a commitment nobody made.
    expect(response.body.sla).toBeNull();

    const row = await TicketSla.findByPk(response.body.id);
    expect(row).toBeNull();

    const ticket = await Ticket.findByPk(response.body.id);
    expect(ticket?.due_at).toBeNull();
  });

  it('leaves a ticket with no policy out of every overdue report', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    const customer = await seedCustomer();

    const response = await agent.post('/api/tickets').send({
      customerId: customer.id,
      subject: 'No policies exist at all',
      category: 'general',
      priority: 'normal',
    });

    expect(response.status).toBe(201);
    expect(response.body.sla).toBeNull();

    // Phase 4's overdue filter reads `due_at`, which is null — so a ticket with
    // no commitment cannot appear in it, whatever the clock says.
    const queue = await agent.get('/api/dashboard/queue?overdueOnly=true');
    expect(queue.status).toBe(200);
    expect(queue.body.items).toHaveLength(0);
  });
});

/**
 * FR-013: exactly one policy applies, chosen deterministically.
 *
 * "Whichever the database returned first" is the failure this prevents, and it
 * is invisible until two policies genuinely overlap — which is exactly when the
 * answer matters most.
 */
describe('policy precedence is deterministic and total (FR-013)', () => {
  it('prefers priority+category over priority alone', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    const broad = await seedPolicy({ priority: 'urgent', responseMinutes: 60 });
    const narrow = await seedPolicy({
      priority: 'urgent',
      category: 'billing',
      responseMinutes: 15,
    });
    const customer = await seedCustomer();

    const response = await agent.post('/api/tickets').send({
      customerId: customer.id,
      subject: 'Urgent billing',
      category: 'billing',
      priority: 'urgent',
    });

    expect(response.body.sla.policyId).toBe(narrow.id);
    expect(response.body.sla.policyId).not.toBe(broad.id);
  });

  it('prefers priority over category when both are equally applicable', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    const byCategory = await seedPolicy({ category: 'billing' });
    const byPriority = await seedPolicy({ priority: 'urgent' });
    const customer = await seedCustomer();

    const response = await agent.post('/api/tickets').send({
      customerId: customer.id,
      subject: 'Urgent billing',
      category: 'billing',
      priority: 'urgent',
    });

    expect(response.body.sla.policyId).toBe(byPriority.id);
    expect(response.body.sla.policyId).not.toBe(byCategory.id);
  });

  it('falls back to a catch-all when nothing more specific matches', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    const catchAll = await seedPolicy({ priority: null, category: null });
    const customer = await seedCustomer();

    const response = await agent.post('/api/tickets').send({
      customerId: customer.id,
      subject: 'Anything',
      category: 'general',
      priority: 'low',
    });

    expect(response.body.sla.policyId).toBe(catchAll.id);
  });

  it('ignores a deactivated policy (FR-005)', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    await seedPolicy({ priority: 'urgent', isActive: false });
    const customer = await seedCustomer();

    const response = await agent.post('/api/tickets').send({
      customerId: customer.id,
      subject: 'Urgent but unpromised',
      category: 'general',
      priority: 'urgent',
    });

    expect(response.body.sla).toBeNull();
  });

  it('is stable: the same state chooses the same policy every time', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    await seedPolicy({ priority: 'urgent', responseMinutes: 60 });
    await seedPolicy({ priority: 'urgent', responseMinutes: 30 });
    const customer = await seedCustomer();

    const chosen: number[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await agent.post('/api/tickets').send({
        customerId: customer.id,
        subject: `Attempt ${attempt}`,
        category: 'general',
        priority: 'urgent',
      });

      chosen.push(response.body.sla.policyId);
    }

    // Two policies of identical specificity. The tie-break must be total, so
    // every ticket lands on the same one — not on whichever row came back.
    expect(new Set(chosen).size).toBe(1);
  });
});
