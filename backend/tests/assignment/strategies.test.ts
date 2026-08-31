import { Op } from 'sequelize';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AssignmentSetting,
  Notification,
  Ticket,
  TicketHistory,
  User,
  UserCompetency,
} from '../../src/models/index.js';
import type { AssignmentStrategy } from '../../src/models/assignment-setting.model.js';
import * as assignmentService from '../../src/services/assignment.service.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs, createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedAlertSubscriptions } from '../sla/helpers.js';
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
 * Automatic assignment (FR-043-FR-053).
 *
 * The load-bearing claim is not "it distributes work" but "IT CANNOT PRODUCE AN
 * ASSIGNMENT A SUPERVISOR COULD NOT HAVE MADE BY HAND". Every eligibility test
 * below is really a test of that: automation reuses the exact three conditions
 * `ticket.service.assign` enforces for a person, so a deactivated, locked, or
 * unpermitted user is unreachable by either route.
 */

async function configure(
  strategy: AssignmentStrategy,
  maxOpenPerAgent: number | null = null,
): Promise<void> {
  await AssignmentSetting.create({ strategy, max_open_per_agent: maxOpenPerAgent });
}

/**
 * Narrow the eligible population to exactly the users a test names.
 *
 * WITHOUT THIS, EVERY TEST HERE IS WRONG IN THE SAME WAY. `truncateAll`
 * reseeds the development administrator, who is active and holds
 * `tickets:view` — so they are genuinely eligible, and being id 1 they win
 * every tie-break by lowest id. That is CORRECT BEHAVIOUR (an administrator can
 * be assigned a ticket by hand, so automation matching the manual guard must
 * be able to select them) and it makes assertions about "which of my three
 * agents got it" meaningless.
 *
 * Deactivating everyone else states the population the test is actually about.
 */
async function isolate(keep: User[]): Promise<void> {
  await User.update(
    { is_active: false },
    { where: { id: { [Op.notIn]: keep.map((user) => user.id) } } },
  );
}

async function unassignedTicket(
  creator: User,
  category: 'general' | 'billing' | 'technical' | 'complaint' = 'general',
): Promise<Ticket> {
  return seedTicket({
    customer: await seedCustomer(),
    createdBy: creator,
    assignee: null,
    status: 'new',
    category,
  });
}

describe('round-robin distributes evenly (FR-046, SC-006)', () => {
  it('gives six tickets to three agents, two each', async () => {
    const a = await createTestUser({ roleKey: 'agent' });
    const b = await createTestUser({ roleKey: 'agent' });
    const c = await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    await isolate([a, b, c]);
    await configure('round_robin');

    const assigned: Array<number | null> = [];

    for (let n = 0; n < 6; n += 1) {
      const ticket = await unassignedTicket(creator);
      const outcome = await assignmentService.autoAssign(ticket.id);
      assigned.push(outcome.userId);
    }

    const counts = new Map<number, number>();

    for (const id of assigned) {
      if (id === null) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    // The supervisor holds `tickets:view` too, so they are eligible — what
    // matters is that the distribution is EVEN, not who is in it.
    const values = [...counts.values()];

    expect(assigned.every((id) => id !== null)).toBe(true);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    expect([a.id, b.id, c.id].every((id) => counts.has(id))).toBe(true);
  });

  it('survives a reassignment, because the cursor is stored not derived', async () => {
    const a = await createTestUser({ roleKey: 'agent' });
    const b = await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    await isolate([a, b]);
    await configure('round_robin');

    const first = await unassignedTicket(creator);
    const firstOutcome = await assignmentService.autoAssign(first.id);

    // A supervisor moves it somewhere else entirely. Deriving the cursor from
    // "who was assigned last" would now be wrong; a stored cursor is not.
    const moved = await Ticket.findByPk(first.id);
    moved!.assignee_user_id = creator.id;
    await moved!.save();

    const second = await unassignedTicket(creator);
    const secondOutcome = await assignmentService.autoAssign(second.id);

    expect(secondOutcome.userId).not.toBe(firstOutcome.userId);
  });
});

describe('least-loaded picks the quietest agent', () => {
  it('prefers the agent with fewest open tickets, breaking ties by id', async () => {
    const busy = await createTestUser({ roleKey: 'agent' });
    const quiet = await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    const customer = await seedCustomer();

    for (let n = 0; n < 3; n += 1) {
      await seedTicket({ customer, createdBy: creator, assignee: busy, status: 'open' });
    }

    await isolate([busy, quiet]);
    await configure('least_loaded');

    const ticket = await unassignedTicket(creator);
    const outcome = await assignmentService.autoAssign(ticket.id);

    expect(outcome.userId).toBe(quiet.id);
  });

  it('is deterministic: identical state gives an identical result', async () => {
    await createTestUser({ roleKey: 'agent' });
    await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    await configure('least_loaded');

    const first = await unassignedTicket(creator);
    const firstOutcome = await assignmentService.autoAssign(first.id);

    // Undo it entirely, then ask again from the same state.
    const reset = await Ticket.findByPk(first.id);
    reset!.assignee_user_id = null;
    await reset!.save();

    const secondOutcome = await assignmentService.autoAssign(first.id);

    expect(secondOutcome.userId).toBe(firstOutcome.userId);
  });
});

describe('competency routes on the ticket category, and falls back (FR-044b)', () => {
  it('prefers an agent competent in the category', async () => {
    const generalist = await createTestUser({ roleKey: 'agent' });
    const specialist = await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    await UserCompetency.create({ user_id: specialist.id, category: 'billing' });
    await isolate([generalist, specialist]);
    await configure('competency');

    const ticket = await unassignedTicket(creator, 'billing');
    const outcome = await assignmentService.autoAssign(ticket.id);

    expect(outcome.userId).toBe(specialist.id);
    expect(outcome.userId).not.toBe(generalist.id);
  });

  it('STILL REACHES AN OWNER when nobody is competent', async () => {
    await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    // Nobody has a competency recorded at all — the most likely real state of a
    // fresh installation. A missing record must never park a ticket, which is
    // the whole reason FR-044b specifies a fallback rather than a refusal.
    await configure('competency');

    const ticket = await unassignedTicket(creator, 'complaint');
    const outcome = await assignmentService.autoAssign(ticket.id);

    expect(outcome.assigned).toBe(true);
    expect(outcome.userId).not.toBeNull();
  });
});

describe('eligibility matches the manual guard exactly (FR-045, SC-007)', () => {
  it('never selects a deactivated user', async () => {
    const gone = await createTestUser({ roleKey: 'agent' });
    const here = await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    gone.is_active = false;
    await gone.save();

    await configure('round_robin');

    for (let n = 0; n < 4; n += 1) {
      const ticket = await unassignedTicket(creator);
      const outcome = await assignmentService.autoAssign(ticket.id);
      expect(outcome.userId).not.toBe(gone.id);
    }

    expect(here.id).toBeGreaterThan(0);
  });

  it('never selects a locked-out user', async () => {
    const locked = await createTestUser({ roleKey: 'agent' });
    await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    locked.locked_until = new Date(Date.now() + 60 * 60_000);
    await locked.save();

    await configure('round_robin');

    for (let n = 0; n < 4; n += 1) {
      const ticket = await unassignedTicket(creator);
      const outcome = await assignmentService.autoAssign(ticket.id);
      expect(outcome.userId).not.toBe(locked.id);
    }
  });

  it('counts a user whose lock has expired as eligible again', async () => {
    const wasLocked = await createTestUser({ roleKey: 'agent' });
    wasLocked.locked_until = new Date(Date.now() - 60 * 60_000);
    await wasLocked.save();

    const eligible = await assignmentService.eligibleAgents();

    // Lockout is "is locked_until in the FUTURE", derived rather than stored —
    // the same reading the User model's own `isLocked` getter uses.
    expect(eligible.map((user) => user.id)).toContain(wasLocked.id);
  });
});

describe('the ceiling and the empty case (FR-047, FR-048)', () => {
  it('does not select an agent already at their ceiling', async () => {
    const agent = await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');
    const customer = await seedCustomer();

    await seedTicket({ customer, createdBy: creator, assignee: agent, status: 'open' });

    await isolate([agent]);
    await configure('round_robin', 1);

    const ticket = await unassignedTicket(creator);
    const outcome = await assignmentService.autoAssign(ticket.id);

    // Both eligible users hold one open ticket and the ceiling is one.
    expect(outcome.assigned).toBe(false);
    expect(outcome.refusal).toBe('all_at_ceiling');
    expect((await Ticket.findByPk(ticket.id))?.assignee_user_id).toBeNull();
  });

  it('leaves the ticket unassigned and records why when nobody is eligible', async () => {
    const { user: creator } = await agentAs('supervisor');

    // Deactivate everyone who could take it, including the creator.
    await User.update({ is_active: false }, { where: {} });

    await configure('round_robin');

    const ticket = await seedTicket({
      customer: await seedCustomer(),
      createdBy: creator,
      assignee: null,
      status: 'new',
    });

    const outcome = await assignmentService.autoAssign(ticket.id);

    expect(outcome.assigned).toBe(false);
    expect(outcome.refusal).toBe('no_eligible_agent');
    // UNASSIGNED, not silently dropped — and the caller alerts the supervisory
    // recipients (FR-048), which ticket.service does on creation.
    expect((await Ticket.findByPk(ticket.id))?.assignee_user_id).toBeNull();
  });
});

describe('a human decision outranks a policy (FR-049)', () => {
  it('never reassigns a ticket somebody already assigned', async () => {
    const chosen = await createTestUser({ roleKey: 'agent' });
    await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    await configure('round_robin');

    const ticket = await seedTicket({
      customer: await seedCustomer(),
      createdBy: creator,
      assignee: chosen,
      status: 'open',
    });

    const outcome = await assignmentService.autoAssign(ticket.id);

    expect(outcome.assigned).toBe(false);
    expect(outcome.refusal).toBe('already_assigned');
    expect((await Ticket.findByPk(ticket.id))?.assignee_user_id).toBe(chosen.id);
  });

  it('does nothing at all while the strategy is off', async () => {
    await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    await configure('off');

    const ticket = await unassignedTicket(creator);
    const outcome = await assignmentService.autoAssign(ticket.id);

    expect(outcome.refusal).toBe('strategy_off');
    expect((await Ticket.findByPk(ticket.id))?.assignee_user_id).toBeNull();
  });

  it('never acts on a closed or merged ticket (FR-052)', async () => {
    await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');
    const customer = await seedCustomer();

    await configure('round_robin');

    const closed = await seedTicket({
      customer,
      createdBy: creator,
      assignee: null,
      status: 'closed',
    });

    expect((await assignmentService.autoAssign(closed.id)).refusal).toBe('not_workable');
  });
});

describe('an automatic assignment behaves like a manual one (FR-050)', () => {
  it('notifies the assignee and records the history as the system', async () => {
    const agent = await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    await seedAlertSubscriptions();
    await isolate([agent]);
    await configure('least_loaded');

    const ticket = await unassignedTicket(creator);
    const outcome = await assignmentService.autoAssign(ticket.id);

    expect(outcome.userId).toBe(agent.id);

    // The SAME notification a manual assignment produces (FR-050) — reusing the
    // type rather than inventing one, because to the agent "work arrived" is one
    // thing, not two.
    const notified = await Notification.findAll({
      where: { ticket_id: ticket.id, user_id: agent.id, type: 'ticket.assigned' },
    });

    expect(notified).toHaveLength(1);

    const history = await TicketHistory.findOne({
      where: { ticket_id: ticket.id, event: 'ticket.assigned' },
    });

    expect(history).not.toBeNull();
    // Attributed to the automation, not to a person (FR-050, FR-039).
    expect(history?.actor_user_id).toBeNull();
  });
});

describe('concurrency leaves exactly one assignee (FR-053)', () => {
  it('does not let two simultaneous attempts both win', async () => {
    await createTestUser({ roleKey: 'agent' });
    await createTestUser({ roleKey: 'agent' });
    const { user: creator } = await agentAs('supervisor');

    await configure('round_robin');

    const ticket = await unassignedTicket(creator);

    const [first, second] = await Promise.all([
      assignmentService.autoAssign(ticket.id),
      assignmentService.autoAssign(ticket.id),
    ]);

    // One claims it; the other finds `assignee_user_id IS NULL` no longer true
    // and reports `already_assigned` rather than overwriting a colleague.
    const wins = [first, second].filter((outcome) => outcome.assigned);

    expect(wins).toHaveLength(1);

    const reloaded = await Ticket.findByPk(ticket.id);
    expect(reloaded?.assignee_user_id).toBe(wins[0]?.userId);
  });
});
