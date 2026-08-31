import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import { workingTimeBetween } from '../../src/lib/business-hours.js';
import { Ticket, TicketSla } from '../../src/models/index.js';
import * as calendarService from '../../src/services/calendar.service.js';
import * as slaTargetService from '../../src/services/sla-target.service.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedTicket } from '../tickets/helpers.js';
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
 * FR-021 and FR-022: the clock stops while we are waiting on the customer, and
 * paused time is excluded EXACTLY ONCE however many times it happens.
 *
 * Driven at the SERVICE layer with a controlled clock, because that is the only
 * way to prove "exactly once" without waiting real hours — the same discipline
 * Phase 4 applied to its scheduler sweeps.
 *
 * The "exactly once" half is what the design was chosen for (research D3):
 * pausing REWRITES the target rather than accumulating an offset, so there is
 * no running total to double-count. The obvious alternative — accumulate a
 * paused duration and subtract it at read time — has to subtract WORKING time
 * rather than wall-clock time, or a weekend spent paused is deducted twice:
 * once by the calendar and once by the offset.
 */

/** A working Sunday at 09:00 Africa/Cairo in the seeded calendar. */
const START = new Date('2026-08-30T06:00:00.000Z');
const ONE_HOUR = 60 * 60_000;

async function ticketWithClock(): Promise<Ticket> {
  const { user } = await agentAs('supervisor');
  await seedCalendar();
  await seedPolicy({ priority: 'normal', responseMinutes: 240, resolutionMinutes: 480 });

  const ticket = await seedTicket({
    customer: await seedCustomer(),
    createdBy: user,
    assignee: user,
    status: 'open',
    priority: 'normal',
  });

  await sequelize.transaction(async (transaction) => {
    await slaTargetService.attachTargets(ticket, transaction, START);
  });

  return ticket;
}

describe('pausing stops the clock (FR-021)', () => {
  it('captures what was LEFT rather than when we stopped', async () => {
    const ticket = await ticketWithClock();
    const before = await TicketSla.findByPk(ticket.id);
    const targetBefore = before!.resolution_target_at!.getTime();

    const pausedAt = new Date(START.getTime() + 30 * 60_000);

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.pause(ticket.id, pausedAt, transaction);
    });

    const row = await TicketSla.findByPk(ticket.id);

    expect(row?.paused_at?.getTime()).toBe(pausedAt.getTime());
    // The REMAINDER, which is what makes resume arithmetic-free.
    expect(Number(row!.resolution_remaining_ms)).toBeGreaterThan(0);
    // The stored target has not moved: the sweep skips paused rows, so a stale
    // value is harmless and the display reads the remainder instead.
    expect(row!.resolution_target_at!.getTime()).toBe(targetBefore);
  });

  it('is a no-op when the clock is already stopped', async () => {
    const ticket = await ticketWithClock();
    const first = new Date(START.getTime() + 30 * 60_000);

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.pause(ticket.id, first, transaction);
    });

    // A second pause must not overwrite the remainder with a smaller one —
    // that would quietly consume time the organisation was not working.
    await sequelize.transaction(async (transaction) => {
      await slaTargetService.pause(ticket.id, new Date(first.getTime() + ONE_HOUR), transaction);
    });

    const row = await TicketSla.findByPk(ticket.id);
    expect(row?.paused_at?.getTime()).toBe(first.getTime());
  });
});

describe('resuming restarts it with what remained', () => {
  it('rewrites the target as "now plus what was left", and moves the due date with it', async () => {
    const ticket = await ticketWithClock();
    const pausedAt = new Date(START.getTime() + 30 * 60_000);

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.pause(ticket.id, pausedAt, transaction);
    });

    const whilePaused = await TicketSla.findByPk(ticket.id);
    const remaining = Number(whilePaused!.resolution_remaining_ms);

    const resumedAt = new Date(pausedAt.getTime() + ONE_HOUR);

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.resume(ticket.id, resumedAt, transaction);
    });

    const row = await TicketSla.findByPk(ticket.id);

    expect(row?.paused_at).toBeNull();
    expect(row?.resolution_remaining_ms).toBeNull();
    expect(row!.resolution_target_at!.getTime()).toBeGreaterThan(resumedAt.getTime());

    // The paused hour cost nothing: what remained at the pause is what remains
    // from the resume — measured in WORKING time, because the resumed target
    // can land on the next working day and a raw timestamp difference would
    // count the intervening night.
    const calendar = await calendarService.workingCalendar();
    const nowRemaining = workingTimeBetween(resumedAt, row!.resolution_target_at!, calendar);

    expect(Math.abs(nowRemaining - remaining)).toBeLessThanOrEqual(60_000);

    // And the Phase 4 due date followed it through the seam.
    const reloaded = await Ticket.findByPk(ticket.id);
    expect(reloaded?.due_at?.getTime()).toBe(row!.resolution_target_at!.getTime());
  });

  it('does not compound across three pause and resume cycles (FR-022)', async () => {
    const ticket = await ticketWithClock();
    const initial = await TicketSla.findByPk(ticket.id);

    // MEASURED IN WORKING TIME, NOT WALL CLOCK, and the distinction is the
    // whole subject of this test. A 480-working-minute target from Sunday 09:00
    // lands at Sunday 17:00; the same target with four hours consumed lands on
    // MONDAY, twenty-odd wall-clock hours later. Subtracting raw timestamps
    // would "prove" that sixteen hours had been consumed by a ticket nobody
    // touched over the weekend.
    const calendar = await calendarService.workingCalendar();
    const budget = workingTimeBetween(START, initial!.resolution_target_at!, calendar);

    // 30 minutes of work, then three cycles of (1h paused + 10 minutes worked).
    let clock = new Date(START.getTime() + 30 * 60_000);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await sequelize.transaction(async (transaction) => {
        await slaTargetService.pause(ticket.id, clock, transaction);
      });

      clock = new Date(clock.getTime() + ONE_HOUR);

      await sequelize.transaction(async (transaction) => {
        await slaTargetService.resume(ticket.id, clock, transaction);
      });

      clock = new Date(clock.getTime() + 10 * 60_000);
    }

    const row = await TicketSla.findByPk(ticket.id);

    // 30 + 3x10 = 60 minutes of working time consumed. The three paused hours
    // must have cost NOTHING — and must not have been credited back either,
    // which is exactly what a double-exclusion bug produces.
    const remaining = workingTimeBetween(clock, row!.resolution_target_at!, calendar);
    const consumed = budget - remaining;

    expect(Math.abs(consumed - ONE_HOUR)).toBeLessThanOrEqual(2 * 60_000);

    // The running total is the three paused hours — and it is DISPLAY ONLY.
    // Nothing above read it; if it ever enters the arithmetic, the assertion
    // one line up is what breaks.
    expect(Number(row!.total_paused_ms)).toBe(3 * ONE_HOUR);
  });
});

describe('the first reply satisfies the response target, once (FR-015, FR-016)', () => {
  it('is satisfied by an outbound message and never re-armed', async () => {
    const ticket = await ticketWithClock();
    const first = new Date(START.getTime() + ONE_HOUR);

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.satisfyResponse(ticket.id, first, transaction);
    });

    expect((await TicketSla.findByPk(ticket.id))?.response_satisfied_at?.getTime()).toBe(
      first.getTime(),
    );

    // A later reply must NOT move it. FR-016 holds by construction — the
    // service writes once and nothing clears the column — so this guards the
    // property rather than a branch.
    await sequelize.transaction(async (transaction) => {
      await slaTargetService.satisfyResponse(
        ticket.id,
        new Date(first.getTime() + 24 * ONE_HOUR),
        transaction,
      );
    });

    expect((await TicketSla.findByPk(ticket.id))?.response_satisfied_at?.getTime()).toBe(
      first.getTime(),
    );
  });
});

describe('reopening arms a fresh target (FR-030)', () => {
  it('is not instantly breached by the expired original', async () => {
    const ticket = await ticketWithClock();

    // The original promise is missed and the ticket is resolved late.
    await sequelize.transaction(async (transaction) => {
      await slaTargetService.satisfyResolution(
        ticket.id,
        new Date(START.getTime() + 40 * ONE_HOUR),
        transaction,
      );
    });

    const resolved = await TicketSla.findByPk(ticket.id);
    const originalTarget = resolved!.resolution_target_at!.getTime();

    // Weeks later, the customer comes back.
    const reopenedAt = new Date('2026-09-20T06:00:00.000Z');

    await sequelize.transaction(async (transaction) => {
      await slaTargetService.rearmOnReopen(ticket, reopenedAt, transaction);
    });

    const row = await TicketSla.findByPk(ticket.id);

    expect(row?.resolution_satisfied_at).toBeNull();
    // A NEW target, in the future — not the expired one, which would make the
    // ticket breached the instant it reopened.
    expect(row!.resolution_target_at!.getTime()).toBeGreaterThan(reopenedAt.getTime());
    expect(row!.resolution_target_at!.getTime()).not.toBe(originalTarget);
    // And because the target is a NEW VALUE, the escalation marker no longer
    // matches it — which is how a fresh escalation is armed without any code
    // that "resets" anything (research D4).
    expect(row?.resolution_escalated_for).toBeNull();
  });
});
