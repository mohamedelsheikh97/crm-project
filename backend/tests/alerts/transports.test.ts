import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { AlertDelivery, Notification, Ticket, User } from '../../src/models/index.js';
import { ALERT_EVENTS } from '../../src/models/alert-subscription.model.js';
import * as alertService from '../../src/services/alert.service.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedAlertSubscriptions } from '../sla/helpers.js';
import { seedTicket } from '../tickets/helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetRateLimit();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * Alerts (FR-072-FR-081).
 *
 * THE CLAIM UNDER TEST IS NOT "alerts are delivered" but "NOTHING ABOUT A
 * TRANSPORT CAN PREVENT THE THING IT REPORTS". An escalation that happened and
 * told nobody is the failure this phase exists to prevent, and the transport
 * most likely to be unconfigured is the one least able to be trusted with that
 * job — so the in-application notification is created first, in the caller's
 * transaction, and everything else happens after the commit.
 */

async function ticketFor(
  assign = true,
): Promise<{ ticket: Ticket; assignee: User; supervisor: User }> {
  const { user: agent } = await agentAs('agent');
  const { user: supervisor } = await agentAs('supervisor');

  const ticket = await seedTicket({
    customer: await seedCustomer(),
    createdBy: supervisor,
    assignee: assign ? agent : null,
    status: 'open',
  });

  return { ticket, assignee: agent, supervisor };
}

describe('the in-application notification is unconditional (FR-073, SC-009)', () => {
  it('is created for every recipient', async () => {
    const { ticket, assignee, supervisor } = await ticketFor();
    await seedAlertSubscriptions();

    await sequelize.transaction(async (transaction) => {
      await alertService.dispatch(
        ALERT_EVENTS.RESOLUTION_BREACHED,
        { ticketId: ticket.id, assigneeUserId: assignee.id },
        transaction,
      );
    });

    const notified = await Notification.findAll({ where: { ticket_id: ticket.id } });
    const ids = notified.map((row) => row.user_id);

    expect(ids).toContain(assignee.id);
    expect(ids).toContain(supervisor.id);
  });

  it('arrives even when email and SMS are both switched on and unreachable', async () => {
    const { ticket, assignee } = await ticketFor();

    // Both outbound transports requested. Neither user has an `alert_phone`,
    // and the email simulator will be the only thing that answers.
    await seedAlertSubscriptions({ byEmail: true, bySms: true });

    await sequelize.transaction(async (transaction) => {
      await alertService.dispatch(
        ALERT_EVENTS.RESOLUTION_BREACHED,
        { ticketId: ticket.id, assigneeUserId: assignee.id },
        transaction,
      );
    });

    const notified = await Notification.count({ where: { ticket_id: ticket.id } });

    // The in-app half is already committed by the time anything is attempted
    // outbound, which is what makes FR-075 structural rather than best effort.
    expect(notified).toBeGreaterThanOrEqual(2);

    const inApp = await AlertDelivery.findAll({
      where: { ticket_id: ticket.id, transport: 'in_app' },
    });

    expect(inApp.length).toBeGreaterThanOrEqual(2);
    expect(inApp.every((row) => row.outcome === 'delivered')).toBe(true);
  });
});

describe('recipients are deduplicated by user (FR-041)', () => {
  it('tells someone once when they match two subscriptions', async () => {
    const { user: supervisor } = await agentAs('supervisor');
    await seedAlertSubscriptions();

    const ticket = await seedTicket({
      customer: await seedCustomer(),
      createdBy: supervisor,
      assignee: supervisor,
      status: 'open',
    });

    await sequelize.transaction(async (transaction) => {
      await alertService.dispatch(
        ALERT_EVENTS.RESOLUTION_BREACHED,
        { ticketId: ticket.id, assigneeUserId: supervisor.id },
        transaction,
      );
    });

    const notified = await Notification.findAll({
      where: { ticket_id: ticket.id, user_id: supervisor.id },
    });

    expect(notified).toHaveLength(1);
  });

  it('still reaches the supervisory recipients when there is no assignee', async () => {
    const { ticket, supervisor } = await ticketFor(false);
    await seedAlertSubscriptions();

    await sequelize.transaction(async (transaction) => {
      await alertService.dispatch(
        ALERT_EVENTS.ASSIGNMENT_FAILED,
        { ticketId: ticket.id, assigneeUserId: null },
        transaction,
      );
    });

    const notified = await Notification.findAll({ where: { ticket_id: ticket.id } });

    // FR-048: an unassignable ticket is a staffing problem, and it must not go
    // unreported for want of somebody to report it to.
    expect(notified.map((row) => row.user_id)).toContain(supervisor.id);
  });

  it('does not tell a deactivated assignee, and still tells the supervisors', async () => {
    const { ticket, assignee, supervisor } = await ticketFor();
    await seedAlertSubscriptions();

    assignee.is_active = false;
    await assignee.save();

    await sequelize.transaction(async (transaction) => {
      await alertService.dispatch(
        ALERT_EVENTS.RESOLUTION_BREACHED,
        { ticketId: ticket.id, assigneeUserId: assignee.id },
        transaction,
      );
    });

    const ids = (await Notification.findAll({ where: { ticket_id: ticket.id } })).map(
      (row) => row.user_id,
    );

    expect(ids).not.toContain(assignee.id);
    expect(ids).toContain(supervisor.id);
  });
});

describe('skipped and failed are different facts (FR-076, FR-077)', () => {
  it('records SKIPPED for a recipient with no alert_phone', async () => {
    const { ticket, assignee } = await ticketFor();
    await seedAlertSubscriptions({ bySms: true });

    await sequelize.transaction(async (transaction) => {
      await alertService.dispatch(
        ALERT_EVENTS.RESOLUTION_BREACHED,
        { ticketId: ticket.id, assigneeUserId: assignee.id },
        transaction,
      );
    });

    // The afterCommit work is fire-and-forget; give it a turn to land.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const sms = await AlertDelivery.findAll({
      where: { ticket_id: ticket.id, transport: 'sms' },
    });

    expect(sms.length).toBeGreaterThanOrEqual(1);
    // SKIPPED, not failed. There was nothing to try, which is a different fact
    // from having tried and been refused — and it is the difference somebody
    // needs at 03:00 when an escalation went unanswered.
    expect(sms.every((row) => row.outcome === 'skipped')).toBe(true);
  });

  it('records a delivery row per attempted transport', async () => {
    const { ticket, assignee } = await ticketFor();

    assignee.alert_phone = '+201001234567';
    await assignee.save();

    await seedAlertSubscriptions({ byEmail: true, bySms: true });

    await sequelize.transaction(async (transaction) => {
      await alertService.dispatch(
        ALERT_EVENTS.RESOLUTION_BREACHED,
        { ticketId: ticket.id, assigneeUserId: assignee.id },
        transaction,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    const rows = await AlertDelivery.findAll({ where: { ticket_id: ticket.id } });
    const transports = new Set(rows.map((row) => row.transport));

    expect(transports.has('in_app')).toBe(true);
    expect(transports.has('email')).toBe(true);
    expect(transports.has('sms')).toBe(true);

    // Every row has an outcome — "nobody was told" is never inferred from an
    // absent row.
    expect(rows.every((row) => row.outcome !== null)).toBe(true);
  });
});

describe('outbound volume is bounded (FR-078, SC-010)', () => {
  it('records SUPPRESSED beyond the ceiling rather than discarding silently', async () => {
    const { ticket, assignee } = await ticketFor();

    assignee.alert_phone = '+201001234567';
    await assignee.save();

    await seedAlertSubscriptions({ byEmail: true });

    // The ceiling defaults to 20 per recipient per hour. Fire well past it.
    for (let n = 0; n < 25; n += 1) {
      await sequelize.transaction(async (transaction) => {
        await alertService.dispatch(
          ALERT_EVENTS.RESOLUTION_BREACHED,
          { ticketId: ticket.id, assigneeUserId: assignee.id },
          transaction,
        );
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 800));

    const suppressed = await AlertDelivery.count({
      where: { ticket_id: ticket.id, outcome: 'suppressed' },
    });

    // Recorded, not discarded: a suppressed alert that left no trace is
    // indistinguishable from a bug in the sender.
    expect(suppressed).toBeGreaterThanOrEqual(1);

    // And the in-app notifications kept flowing throughout — the ceiling bounds
    // what LEAVES the system, not what it records for the person who has to act.
    const inApp = await AlertDelivery.count({
      where: { ticket_id: ticket.id, transport: 'in_app', outcome: 'delivered' },
    });

    expect(inApp).toBeGreaterThanOrEqual(25);
  });
});

describe('the subscription view reports what an administrator needs (FR-079)', () => {
  it('lists events with their recipients and unreachable counts', async () => {
    await agentAs('supervisor');
    await seedAlertSubscriptions({ bySms: true });

    const events = await alertService.listSubscriptions();

    expect(events.length).toBeGreaterThanOrEqual(1);

    const breach = events.find((entry) => entry.eventKey === 'sla.resolution_breached');

    expect(breach).toBeDefined();
    // FR-073 rendered as data: in-app always reads true, so the screen can show
    // a disabled always-on control rather than hide a transport that behaves
    // differently from the two beside it.
    expect(breach!.subscriptions.every((row) => row.inApp)).toBe(true);

    const roleRow = breach!.subscriptions.find((row) => row.recipientKind === 'role');

    // Nobody has an alert phone, so SMS would reach none of them — said up
    // front rather than discovered in the delivery log.
    expect(roleRow?.unreachableForSms).toBeGreaterThanOrEqual(1);
  });
});
