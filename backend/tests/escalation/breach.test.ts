import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import { runScheduledSweeps } from '../../src/lib/scheduler.js';
import {
  AlertDelivery,
  AuditLog,
  Notification,
  Ticket,
  TicketHistory,
  TicketSla,
} from '../../src/models/index.js';
import * as escalationService from '../../src/services/sla-escalation.service.js';
import * as slaTargetService from '../../src/services/sla-target.service.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedAlertSubscriptions, seedCalendar, seedPolicy } from '../sla/helpers.js';
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

/**
 * PLAN.md's Definition of done for Phase 6:
 *
 *   "A ticket that breaches its SLA escalates and notifies the right people
 *    without manual intervention."
 *
 * Everything here is driven with a CONTROLLED CLOCK by calling the sweep
 * directly. No test waits on a timer — the discipline Phase 4 established for
 * exactly this reason, and the only way to assert "exactly once" across many
 * passes without waiting real hours.
 */

const START = new Date('2026-08-30T06:00:00.000Z'); // Sunday 09:00 Africa/Cairo

/**
 * A ticket whose RESOLUTION target is already in the past when the sweep runs.
 *
 * The first response is marked satisfied by default, and that is not incidental
 * tidying: a ticket with BOTH targets breached fires two events, and both map
 * to the same in-app notification type — so a test counting notifications would
 * be measuring two breaches while claiming to measure one. Satisfying the reply
 * is also the realistic shape of the case escalation exists for: somebody
 * answered the customer and then the matter went unresolved.
 *
 * `respond: false` leaves it unsatisfied for the tests that are about the
 * first-response breach itself.
 */
async function breachedTicket(
  options: {
    assign?: boolean;
    status?: 'new' | 'open' | 'pending' | 'closed';
    respond?: boolean;
  } = {},
): Promise<{ ticket: Ticket; assigneeId: number | null; supervisorId: number }> {
  const { user: agent } = await agentAs('agent');
  const { user: supervisor } = await agentAs('supervisor');

  await seedCalendar();
  await seedPolicy({ priority: 'normal', responseMinutes: 240, resolutionMinutes: 480 });
  await seedAlertSubscriptions();

  const ticket = await seedTicket({
    customer: await seedCustomer(),
    createdBy: supervisor,
    assignee: options.assign === false ? null : agent,
    status: options.status ?? 'open',
    priority: 'normal',
  });

  await sequelize.transaction(async (transaction) => {
    await slaTargetService.attachTargets(ticket, transaction, START);

    if (options.respond !== false) {
      await slaTargetService.satisfyResponse(ticket.id, START, transaction);
    }
  });

  return {
    ticket,
    assigneeId: options.assign === false ? null : agent.id,
    supervisorId: supervisor.id,
  };
}

/** Well past both targets. */
const LATE = new Date('2026-09-10T06:00:00.000Z');

describe('a breach escalates and notifies, with nobody watching', () => {
  it('escalates the ticket, records why, and tells the right people', async () => {
    const { ticket, assigneeId, supervisorId } = await breachedTicket();

    const result = await escalationService.detectAndAct(LATE);

    expect(result.escalated).toBe(1);

    const reloaded = await Ticket.findByPk(ticket.id);

    expect(reloaded?.status).toBe('escalated');
    // An i18n KEY, not a sentence: an Arabic supervisor must not be shown
    // English (FR-036, Principle I).
    expect(reloaded?.escalation_reason).toBe('ticket.sla.escalationReason.resolutionBreached');

    // FR-039: the ticket's own history says THE SYSTEM did it.
    const escalation = await TicketHistory.findOne({
      where: { ticket_id: ticket.id, event: 'ticket.escalated' },
    });

    expect(escalation).not.toBeNull();
    expect(escalation?.actor_user_id).toBeNull();

    // FR-040, with a null actor — no person authorised THIS escalation.
    const audit = await AuditLog.findOne({
      where: { action: 'ticket.escalated', target_id: String(ticket.id) },
    });

    expect(audit).not.toBeNull();
    expect(audit?.actor_user_id).toBeNull();

    // FR-041: the assignee AND the supervisory recipients.
    const notified = await Notification.findAll({
      where: { ticket_id: ticket.id, type: 'sla.breached' },
    });
    const notifiedIds = notified.map((row) => row.user_id);

    expect(notifiedIds).toContain(assigneeId);
    expect(notifiedIds).toContain(supervisorId);
  });

  it('records the breach outcome for later reporting (FR-018)', async () => {
    const { ticket } = await breachedTicket();

    await escalationService.detectAndAct(LATE);

    const row = await TicketSla.findByPk(ticket.id);

    // The STORED outcome is the record. Phase 10 must read this rather than
    // recompute it, because the policy that produced it may since have changed.
    expect(row?.resolution_breached_at).not.toBeNull();
    expect(row?.resolution_escalated_for?.getTime()).toBe(row?.resolution_target_at?.getTime());
  });

  it('runs from the scheduler sweep alongside the Phase 4 sweeps', async () => {
    await breachedTicket();

    // The third sweep is wired into the SAME timer, so this is the entry point
    // a live process actually uses.
    const result = await runScheduledSweeps(LATE);

    expect(result.slaActions).toBeGreaterThanOrEqual(1);
  });
});

describe('detection is idempotent (FR-034, SC-004)', () => {
  it('produces exactly one escalation across many passes', async () => {
    const { ticket } = await breachedTicket();

    for (let pass = 0; pass < 10; pass += 1) {
      await escalationService.detectAndAct(new Date(LATE.getTime() + pass * 60_000));
    }

    const escalations = await TicketHistory.findAll({
      where: { ticket_id: ticket.id, event: 'ticket.escalated' },
    });
    const notifications = await Notification.findAll({
      where: { ticket_id: ticket.id, type: 'sla.breached' },
    });
    const audits = await AuditLog.findAll({
      where: { action: 'ticket.escalated', target_id: String(ticket.id) },
    });

    expect(escalations).toHaveLength(1);
    expect(audits).toHaveLength(1);
    // One per recipient, not one per pass.
    expect(notifications).toHaveLength(2);
  });

  it('does not re-escalate after a manual de-escalation (FR-042)', async () => {
    const { ticket } = await breachedTicket();

    await escalationService.detectAndAct(LATE);

    // A supervisor decides it is under control and brings it back down.
    const reloaded = await Ticket.findByPk(ticket.id);
    reloaded!.status = 'open';
    reloaded!.escalation_reason = null;
    await reloaded!.save();

    await escalationService.detectAndAct(new Date(LATE.getTime() + 60_000));

    // NOTHING CHANGED, so nothing re-arms. The marker still equals the target.
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('open');
    expect(
      await TicketHistory.count({ where: { ticket_id: ticket.id, event: 'ticket.escalated' } }),
    ).toBe(1);
  });

  it('re-arms when the target genuinely changes (FR-030)', async () => {
    const { ticket } = await breachedTicket();

    await escalationService.detectAndAct(LATE);
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('escalated');

    // Resolve it, then reopen weeks later: `rearmOnReopen` writes a NEW target
    // value, so the marker no longer matches and a fresh escalation is armed —
    // without any code that "resets" anything (research D4).
    const reloaded = await Ticket.findByPk(ticket.id);

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.satisfyResolution(ticket.id, LATE, transaction);
    });

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.rearmOnReopen(
        reloaded!,
        new Date('2026-09-20T06:00:00.000Z'),
        transaction,
      );
    });

    const row = await TicketSla.findByPk(ticket.id);

    expect(row?.resolution_escalated_for).toBeNull();
    // And it is NOT instantly breached: the new target is in the future.
    const afterReopen = await escalationService.detectAndAct(new Date('2026-09-20T07:00:00.000Z'));
    expect(afterReopen.escalated).toBe(0);
  });
});

describe('nothing depends on having been running (FR-035)', () => {
  it('detects a target that expired while the process was down', async () => {
    const { ticket } = await breachedTicket();

    // The target passed days ago and no sweep ran in between. There is no
    // "since last run" bookkeeping anywhere in the path, so the first pass
    // after restart finds it by state comparison alone.
    const result = await escalationService.detectAndAct(new Date('2026-09-25T06:00:00.000Z'));

    expect(result.escalated).toBe(1);
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('escalated');
  });
});

describe('a ticket nobody opened still escalates (research D11)', () => {
  it('escalates from `new`, which Phase 3 alone would have refused', async () => {
    // THE CASE THE LIFECYCLE EDGE EXISTS FOR. A ticket that arrived overnight
    // and that nobody has touched is the one escalation most exists for; before
    // Phase 6 added `new -> escalated`, it was the only status that could never
    // escalate.
    const { ticket } = await breachedTicket({ status: 'new' });

    const result = await escalationService.detectAndAct(LATE);

    expect(result.escalated).toBe(1);
    expect(result.refused).toBe(0);
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('escalated');
  });
});

describe('an unassigned breach is still reported (FR-041, SC-005)', () => {
  it('escalates and reaches the supervisory recipients', async () => {
    const { ticket, supervisorId } = await breachedTicket({ assign: false });

    const result = await escalationService.detectAndAct(LATE);

    expect(result.escalated).toBe(1);
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('escalated');

    // Nobody to tell as assignee — and it must NOT go unreported.
    const notified = await Notification.findAll({
      where: { ticket_id: ticket.id, type: 'sla.breached' },
    });

    expect(notified.map((row) => row.user_id)).toContain(supervisorId);
  });

  it('tells a recipient once even when they are both assignee and supervisor', async () => {
    const { user: supervisor } = await agentAs('supervisor');
    await seedCalendar();
    await seedPolicy({ priority: 'normal', responseMinutes: 240, resolutionMinutes: 480 });
    await seedAlertSubscriptions();

    const ticket = await seedTicket({
      customer: await seedCustomer(),
      createdBy: supervisor,
      assignee: supervisor,
      status: 'open',
      priority: 'normal',
    });

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.attachTargets(ticket, transaction, START);
      // So exactly ONE breach fires — see `breachedTicket` above.
      await slaTargetService.satisfyResponse(ticket.id, START, transaction);
    });

    await escalationService.detectAndAct(LATE);

    const notified = await Notification.findAll({
      where: { ticket_id: ticket.id, user_id: supervisor.id, type: 'sla.breached' },
    });

    // ONE, not two. FR-041's dedup, merged by user id.
    expect(notified).toHaveLength(1);
  });
});

describe('exclusions (FR-031, FR-032)', () => {
  it('never escalates a closed ticket', async () => {
    const { ticket } = await breachedTicket({ status: 'open' });

    const reloaded = await Ticket.findByPk(ticket.id);
    reloaded!.status = 'closed';
    await reloaded!.save();

    const result = await escalationService.detectAndAct(LATE);

    expect(result.escalated).toBe(0);
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('closed');
  });

  it('never escalates a merged ticket', async () => {
    const { ticket, supervisorId } = await breachedTicket();

    const survivor = await seedTicket({
      customer: await seedCustomer(),
      createdBy: { id: supervisorId } as never,
      status: 'open',
    });

    const reloaded = await Ticket.findByPk(ticket.id);
    reloaded!.merged_into_ticket_id = survivor.id;
    await reloaded!.save();

    const result = await escalationService.detectAndAct(LATE);

    expect(result.escalated).toBe(0);
    expect((await Ticket.findByPk(ticket.id))?.status).not.toBe('escalated');
  });

  it('never escalates a paused ticket (FR-021)', async () => {
    const { ticket } = await breachedTicket();

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.pause(ticket.id, new Date(START.getTime() + 30 * 60_000), transaction);
    });

    const result = await escalationService.detectAndAct(LATE);

    expect(result.escalated).toBe(0);
  });

  it('never escalates a ticket whose resolution target was met', async () => {
    const { ticket } = await breachedTicket();

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.satisfyResolution(ticket.id, START, transaction);
    });

    const result = await escalationService.detectAndAct(LATE);

    expect(result.escalated).toBe(0);
  });
});

describe('warning without escalating (FR-037)', () => {
  it('warns about an approaching target and does not escalate', async () => {
    const { ticket } = await breachedTicket();
    const row = await TicketSla.findByPk(ticket.id);

    // Thirty minutes before the resolution target, inside the 60-minute lead.
    const soon = new Date(row!.resolution_target_at!.getTime() - 30 * 60_000);

    const result = await escalationService.detectAndAct(soon);

    expect(result.escalated).toBe(0);
    expect(result.warned).toBeGreaterThanOrEqual(1);
    expect((await Ticket.findByPk(ticket.id))?.status).toBe('open');

    const warned = await Notification.findAll({
      where: { ticket_id: ticket.id, type: 'sla.at_risk' },
    });

    expect(warned.length).toBeGreaterThanOrEqual(1);
  });

  it('does not warn a second time for the same target', async () => {
    const { ticket } = await breachedTicket();
    const row = await TicketSla.findByPk(ticket.id);
    const soon = new Date(row!.resolution_target_at!.getTime() - 30 * 60_000);

    await escalationService.detectAndAct(soon);
    await escalationService.detectAndAct(new Date(soon.getTime() + 60_000));

    const warned = await Notification.findAll({
      where: { ticket_id: ticket.id, type: 'sla.at_risk' },
    });

    // One per recipient, not one per pass.
    expect(warned).toHaveLength(2);
  });

  it('escalates without warning when the target passed unseen', async () => {
    const { ticket } = await breachedTicket();

    // Straight past the target: the at-risk query excludes anything already
    // late, so a ticket cannot be warned retrospectively AND escalated for the
    // same target in one pass.
    await escalationService.detectAndAct(LATE);

    const warned = await Notification.count({
      where: { ticket_id: ticket.id, type: 'sla.at_risk' },
    });
    const breached = await Notification.count({
      where: { ticket_id: ticket.id, type: 'sla.breached' },
    });

    expect(warned).toBe(0);
    expect(breached).toBeGreaterThanOrEqual(1);
  });
});

describe('every alert attempt is recorded (FR-076)', () => {
  it('writes an in-application delivery row per recipient', async () => {
    const { ticket } = await breachedTicket();

    await escalationService.detectAndAct(LATE);

    const deliveries = await AlertDelivery.findAll({
      where: { ticket_id: ticket.id, transport: 'in_app' },
    });

    expect(deliveries.length).toBeGreaterThanOrEqual(2);
    expect(deliveries.every((row) => row.outcome === 'delivered')).toBe(true);
  });
});
