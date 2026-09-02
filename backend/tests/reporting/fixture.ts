import { BusinessCalendar } from '../../src/models/business-calendar.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { SlaPolicy } from '../../src/models/sla-policy.model.js';
import { Ticket } from '../../src/models/ticket.model.js';
import { TicketSatisfaction } from '../../src/models/ticket-satisfaction.model.js';
import { TicketSla } from '../../src/models/ticket-sla.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';

/**
 * The reporting fixture (Phase 10, research D9).
 *
 * A data set built to contain the awkward cases, so the answers in
 * `fixture-answers.ts` had to be decided rather than derived. Every ticket here
 * exists because some edge case in the spec needed a concrete instance:
 *
 *   - three months of tickets, so a period filter has something to exclude
 *   - a MERGED pair (FR-017) — counted once, on the surviving side
 *   - a ticket with NO ASSIGNEE (the null case that makes a percentage wrong)
 *   - a ticket with NO SLA POLICY (FR-023 — excluded, and counted as excluded)
 *   - a ticket OPENED IN ONE MONTH AND CLOSED IN THE NEXT (FR-012)
 *   - a ticket still OPEN from before the reported month (the `openAtEnd` case
 *     a creation-date filter would miss)
 *   - satisfaction on a SUBSET, so the response rate denominator is not the
 *     numerator (FR-027)
 *   - two agents, so attribution has somewhere to be wrong (research D4)
 *
 * THE MONTH UNDER TEST IS FEBRUARY 2026. Chosen because it is short, which makes
 * a boundary error easier to see by hand, and because the surrounding January
 * and March give the filter something to leave out.
 *
 * All instants are constructed in UTC and the fixture asserts the calendar's
 * timezone is UTC in `fixture-answers.ts`, so the hand-computed answers do not
 * silently depend on the machine's zone.
 */
export const MONTH = { from: '2026-02-01', to: '2026-02-28' } as const;

export interface Fixture {
  readonly customerId: number;
  readonly agentAId: number;
  readonly agentBId: number;
  readonly policyId: number;
  /** The surviving side of the merged pair. */
  readonly survivorTicketId: number;
  /** A ticket resolved inside the month, with a satisfaction score. */
  readonly ratedTicketId: number;
}

/**
 * A UTC business calendar, created by the fixture rather than inherited.
 *
 * THE DEPLOYMENT DEFAULT IS `Africa/Cairo` (see the default-calendar seeder),
 * and `truncateAll()` removes it anyway because the test helper seeds
 * PERMISSIONS, not content. Both facts matter:
 *
 *   - Without a calendar at all, `workingCalendar()` throws NotFound and every
 *     reporting test fails on a cause that looks nothing like the code under
 *     test.
 *   - With the Cairo default, every period boundary shifts by two or three
 *     hours and the hand-computed answers in `fixture-answers.ts` would be
 *     wrong for a reason no reader would look for.
 *
 * So the fixture PINS UTC. The answers file's `REQUIRED_TIME_ZONE` assertion is
 * what caught this, and it stays as the guard against somebody changing it.
 */
export async function ensureUtcCalendar(): Promise<void> {
  await BusinessCalendar.create({
    name: 'Reporting fixture (UTC)',
    time_zone: 'UTC',
    // Sunday..Saturday, all seven bits — the fixture is about counting
    // tickets, not about working hours.
    working_days: 127,
    day_start_minute: 0,
    day_end_minute: 1440,
    is_active: true,
  } as never);
}

function utc(year: number, month: number, day: number, hour = 12): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
}

async function agent(email: string, fullName: string): Promise<number> {
  const role = (await Role.findOne({ where: { key: 'agent' } })) as unknown as { id: number };

  const user = (await User.create({
    email,
    full_name: fullName,
    password_hash: 'x'.repeat(60),
    role_id: role.id,
    is_active: true,
  } as never)) as unknown as { id: number };

  return user.id;
}

/**
 * Builds the fixture. Call after `truncateAll()`.
 *
 * Deliberately verbose rather than loop-generated: a reader checking the
 * hand-computed answers needs to be able to count the tickets in this file.
 */
export async function build(): Promise<Fixture> {
  await ensureUtcCalendar();

  const customer = (await Customer.create({
    display_name: 'Acme',
    type: 'company',
    status: 'active',
  } as never)) as unknown as { id: number };

  const agentAId = await agent('agent-a@crm.local', 'Agent A');
  const agentBId = await agent('agent-b@crm.local', 'Agent B');

  const policy = (await SlaPolicy.create({
    name: 'Standard',
    response_minutes: 60,
    resolution_minutes: 480,
    is_active: true,
  } as never)) as unknown as { id: number };

  const make = async (
    subject: string,
    createdAt: Date,
    overrides: Record<string, unknown> = {},
  ): Promise<number> => {
    const ticket = (await Ticket.create({
      customer_id: customer.id,
      subject,
      description: subject,
      category: 'general',
      priority: 'normal',
      status: 'open',
      source: 'email',
      assignee_user_id: agentAId,
      created_at: createdAt,
      ...overrides,
    } as never)) as unknown as { id: number };

    // Sequelize overrides created_at with NOW on insert unless timestamps are
    // silenced; set it explicitly afterwards so the fixture's dates are the
    // dates the report will see.
    await Ticket.update({ created_at: createdAt } as never, {
      where: { id: ticket.id },
      silent: true,
    });

    return ticket.id;
  };

  // ─── January: outside the reported month ────────────────────────────────
  await make('JAN technical question', utc(2026, 1, 15), { category: 'technical' });

  // Raised in January, STILL OPEN at the end of February. This is the ticket a
  // creation-date filter would miss from `openAtEnd` (FR-016).
  await make('JAN still open in February', utc(2026, 1, 20));

  // ─── February: the reported month ──────────────────────────────────────
  const survivorTicketId = await make('FEB billing dispute', utc(2026, 2, 3), {
    category: 'billing',
  });

  // The absorbed side of the merge. Counted ZERO times (FR-017).
  await make('FEB duplicate of the billing dispute', utc(2026, 2, 3), {
    category: 'billing',
    merged_into_ticket_id: survivorTicketId,
    status: 'closed',
  });

  const technicalId = await make('FEB technical fault', utc(2026, 2, 10), {
    category: 'technical',
    assignee_user_id: agentBId,
  });

  // No assignee. The null case that makes an agent breakdown not sum to the
  // total unless the exclusion is reported (FR-004).
  const complaintId = await make('FEB unassigned complaint', utc(2026, 2, 12), {
    category: 'complaint',
    assignee_user_id: null,
  });

  // Arrived by portal rather than email, so the channel breakdown has more than
  // one bucket.
  const portalId = await make('FEB portal request', utc(2026, 2, 18), { source: 'portal' });

  /**
   * Opened in February, CLOSED IN MARCH (FR-012) — and its current status is
   * `closed`.
   *
   * THIS TICKET IS THE FIXTURE'S MOST INSTRUCTIVE ROW, because it demonstrates
   * Clarifications Q3's accepted cost. It WAS open at the end of February, but
   * `ticketsOpenAt` reads CURRENT status, so today's report does not count it
   * as open then. A report of February run in February and the same report run
   * in April give different `openAtEnd` figures.
   *
   * That is the documented behaviour, not a bug — FR-011a requires every report
   * to say it reflects current state, and this is the row that makes the
   * consequence concrete rather than theoretical.
   */
  const closedInMarchId = await make('FEB opened, closed in March', utc(2026, 2, 26), {
    status: 'closed',
  });

  // Resolved inside February, and rated. The CSAT numerator.
  const ratedTicketId = await make('FEB resolved and rated', utc(2026, 2, 5), {
    status: 'resolved',
  });

  // Resolved inside February and NOT rated. The response-rate denominator's
  // other half (FR-027).
  const unratedTicketId = await make('FEB resolved, never rated', utc(2026, 2, 6), {
    status: 'resolved',
  });

  // ─── March: outside the reported month ─────────────────────────────────
  await make('MAR later ticket', utc(2026, 3, 4));

  // ─── SLA rows ──────────────────────────────────────────────────────────
  // Response met, resolution met.
  await TicketSla.create({
    ticket_id: survivorTicketId,
    policy_id: policy.id,
    started_at: utc(2026, 2, 3),
    response_target_at: utc(2026, 2, 3, 13),
    resolution_target_at: utc(2026, 2, 3, 20),
    response_satisfied_at: utc(2026, 2, 3, 12),
    resolution_satisfied_at: utc(2026, 2, 3, 18),
  } as never);

  // Response BREACHED, resolution met.
  await TicketSla.create({
    ticket_id: ratedTicketId,
    policy_id: policy.id,
    started_at: utc(2026, 2, 5),
    response_target_at: utc(2026, 2, 5, 13),
    resolution_target_at: utc(2026, 2, 5, 20),
    response_breached_at: utc(2026, 2, 5, 14),
    resolution_satisfied_at: utc(2026, 2, 5, 19),
  } as never);

  // Both BREACHED.
  await TicketSla.create({
    ticket_id: unratedTicketId,
    policy_id: policy.id,
    started_at: utc(2026, 2, 6),
    response_target_at: utc(2026, 2, 6, 13),
    resolution_target_at: utc(2026, 2, 6, 20),
    response_breached_at: utc(2026, 2, 6, 15),
    resolution_breached_at: utc(2026, 2, 6, 23),
  } as never);

  // Three more MET rows, so the compliance denominator clears the
  // suppression floor and the test exercises real arithmetic rather than only
  // the small-sample path. Six policy rows in total.
  for (const [ticketId, day] of [
    [technicalId, 10],
    [complaintId, 12],
    [closedInMarchId, 26],
  ] as const) {
    await TicketSla.create({
      ticket_id: ticketId,
      policy_id: policy.id,
      started_at: utc(2026, 2, day),
      response_target_at: utc(2026, 2, day, 13),
      resolution_target_at: utc(2026, 2, day, 20),
      response_satisfied_at: utc(2026, 2, day, 12),
      resolution_satisfied_at: utc(2026, 2, day, 18),
    } as never);
  }

  // NO POLICY. Excluded from compliance and counted as excluded (FR-023).
  // Keyed to a real ticket rather than id arithmetic, which would break the
  // moment another row is inserted above it.
  await TicketSla.create({
    ticket_id: portalId,
    policy_id: null,
    started_at: utc(2026, 2, 18),
  } as never);

  // ─── Satisfaction ──────────────────────────────────────────────────────
  await TicketSatisfaction.create({
    ticket_id: ratedTicketId,
    score: 4,
    submitted_by_contact_id: null,
    submitted_at: utc(2026, 2, 7),
  } as never);

  return {
    customerId: customer.id,
    agentAId,
    agentBId,
    policyId: policy.id,
    survivorTicketId,
    ratedTicketId,
  };
}
