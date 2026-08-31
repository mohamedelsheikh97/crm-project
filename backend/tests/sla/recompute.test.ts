import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Ticket, TicketHistory, TicketSla } from '../../src/models/index.js';
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
 * FR-017: changing priority or category re-evaluates which policy applies.
 *
 * THE HARD PART IS NOT THE RECOMPUTATION, it is the baseline. Targets are
 * recomputed from the ticket's ORIGINAL start time, not from now, so a ticket
 * six hours into an eight-hour promise that is raised to `urgent` gets urgent's
 * target measured from when it arrived — and may therefore be immediately at
 * risk, which is correct. Recomputing from `now` would silently forgive every
 * hour already elapsed, and a supervisor could reset any late ticket's clock by
 * nudging its priority.
 */
async function createTicket(
  agent: ReturnType<typeof agentAs> extends Promise<infer T>
    ? T extends { agent: infer A }
      ? A
      : never
    : never,
  customerId: number,
  priority: string,
  category = 'general',
): Promise<{ id: number; version: number }> {
  const response = await (
    agent as {
      post: (p: string) => {
        send: (b: unknown) => Promise<{ body: { id: number; version: number } }>;
      };
    }
  )
    .post('/api/tickets')
    .send({ customerId, subject: 'Recompute me', category, priority });

  return response.body;
}

describe('targets recompute when the ticket changes scope (FR-017)', () => {
  it('moves the ticket to the newly matching policy', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    const normal = await seedPolicy({
      priority: 'normal',
      responseMinutes: 480,
      resolutionMinutes: 1440,
    });
    const urgent = await seedPolicy({
      priority: 'urgent',
      responseMinutes: 60,
      resolutionMinutes: 240,
    });
    const customer = await seedCustomer();

    const created = await createTicket(agent, customer.id, 'normal');
    expect((await TicketSla.findByPk(created.id))?.policy_id).toBe(normal.id);

    const before = await TicketSla.findByPk(created.id);
    const originalStart = before?.started_at.getTime();

    const updated = await agent
      .patch(`/api/tickets/${created.id}`)
      .send({ priority: 'urgent', version: created.version });

    expect(updated.status).toBe(200);

    const after = await TicketSla.findByPk(created.id);

    expect(after?.policy_id).toBe(urgent.id);
    // THE BASELINE IS UNCHANGED. This is the assertion that stops a priority
    // nudge from becoming a way to reset a late ticket's clock.
    expect(after?.started_at.getTime()).toBe(originalStart);
    // Urgent's shorter promise, measured from the same start, must land EARLIER
    // than the one it replaced — not later, which is what recomputing from
    // `now` would produce.
    expect(after!.resolution_target_at!.getTime()).toBeLessThan(
      before!.resolution_target_at!.getTime(),
    );
  });

  it('records the change in the ticket history with both values', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    await seedPolicy({ priority: 'normal', responseMinutes: 480, resolutionMinutes: 1440 });
    await seedPolicy({ priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 });
    const customer = await seedCustomer();

    const created = await createTicket(agent, customer.id, 'normal');

    await agent
      .patch(`/api/tickets/${created.id}`)
      .send({ priority: 'urgent', version: created.version });

    const entries = await TicketHistory.findAll({
      where: { ticket_id: created.id, event: 'ticket.sla.target_changed' },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.previous_value).not.toBeNull();
    expect(entries[0]?.new_value).not.toBeNull();
    expect(entries[0]?.previous_value).not.toBe(entries[0]?.new_value);
    // Attributed to the SYSTEM, not to the person who changed the priority
    // (FR-039): they changed a priority; the policy changed the promise.
    expect(entries[0]?.actor_user_id).toBeNull();
  });

  it('keeps the due date in step through the Phase 4 seam', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    await seedPolicy({ priority: 'normal', responseMinutes: 480, resolutionMinutes: 1440 });
    await seedPolicy({ priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 });
    const customer = await seedCustomer();

    const created = await createTicket(agent, customer.id, 'normal');

    await agent
      .patch(`/api/tickets/${created.id}`)
      .send({ priority: 'urgent', version: created.version });

    const ticket = await Ticket.findByPk(created.id);
    const row = await TicketSla.findByPk(created.id);

    expect(ticket?.due_source).toBe('policy');
    expect(ticket?.due_at?.getTime()).toBe(row?.resolution_target_at?.getTime());
  });

  it('does NOT overwrite a due date a person set (FR-024a)', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    await seedPolicy({ priority: 'normal', responseMinutes: 480, resolutionMinutes: 1440 });
    await seedPolicy({ priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 });
    const customer = await seedCustomer();

    const created = await createTicket(agent, customer.id, 'normal');

    // A commitment negotiated with the customer, typed by a person.
    const manual = new Date('2027-01-15T12:00:00.000Z');
    const set = await agent
      .put(`/api/tickets/${created.id}/due-date`)
      .send({ dueAt: manual.toISOString(), version: created.version });

    expect(set.status).toBe(200);
    expect((await Ticket.findByPk(created.id))?.due_source).toBe('manual');

    const afterManual = await Ticket.findByPk(created.id);

    // Now change the priority, which recomputes the SLA target.
    await agent
      .patch(`/api/tickets/${created.id}`)
      .send({ priority: 'urgent', version: afterManual!.version });

    const ticket = await Ticket.findByPk(created.id);
    const row = await TicketSla.findByPk(created.id);

    // The SLA target moved; the human's date did NOT. That is FR-024a: a policy
    // never quietly overwrites a promise a person made.
    expect(ticket?.due_source).toBe('manual');
    expect(ticket?.due_at?.getTime()).toBe(manual.getTime());
    expect(row?.resolution_target_at?.getTime()).not.toBe(manual.getTime());
  });

  it('stops measuring when the ticket no longer matches any policy', async () => {
    const { agent } = await agentAs('supervisor');
    await seedCalendar();
    await seedPolicy({ priority: 'urgent', responseMinutes: 60, resolutionMinutes: 240 });
    const customer = await seedCustomer();

    const created = await createTicket(agent, customer.id, 'urgent');
    expect(await TicketSla.findByPk(created.id)).not.toBeNull();

    await agent
      .patch(`/api/tickets/${created.id}`)
      .send({ priority: 'low', version: created.version });

    const row = await TicketSla.findByPk(created.id);

    // The ROW SURVIVES — the record of what was once promised does not vanish
    // because the policy set changed — but the targets are cleared, so nothing
    // measures against a commitment that no longer exists.
    expect(row).not.toBeNull();
    expect(row?.resolution_target_at).toBeNull();
    expect(row?.policy_id).toBeNull();
    expect((await Ticket.findByPk(created.id))?.due_at).toBeNull();
  });
});
