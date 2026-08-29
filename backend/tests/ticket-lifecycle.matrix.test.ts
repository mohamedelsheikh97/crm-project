import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { allPermissionKeys } from '../src/auth/permissions.js';
import { Customer, Ticket, User } from '../src/models/index.js';
import {
  TICKET_STATUSES,
  TRANSITIONS,
  isTransitionDeclared,
  type TicketStatus,
} from '../src/tickets/lifecycle.js';
import { seedCustomer } from './customers/helpers.js';
import { agentAs } from './helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from './helpers/database.js';
import { seedTicket } from './tickets/helpers.js';

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
 * THE 36-PAIR MATRIX.
 *
 * Generated from TRANSITIONS rather than hand-listed. Both this test and the
 * enforcement service read the SAME constant, so what is proven here is that
 * the service honours the declaration — not that someone transcribed a list of
 * edges correctly twice.
 *
 * Six statuses gives 36 ordered pairs. 13 are permitted; 23 are not. Every one
 * of the 36 is walked, per role.
 */

const ROLE_KEYS = ['agent', 'supervisor', 'admin'] as const;
type RoleKey = (typeof ROLE_KEYS)[number];

const PAIRS = TICKET_STATUSES.flatMap((from) =>
  TICKET_STATUSES.map((to) => ({ from, to })),
).flatMap((pair) => ROLE_KEYS.map((roleKey) => ({ ...pair, roleKey })));

/**
 * Whether a role is expected to be able to take an edge, derived from the
 * declaration plus the seeded grants.
 *
 * Only two edges differ by role: `resolved -> closed` needs tickets:close, and
 * `closed -> open` needs tickets:reopen, which an Agent does not hold.
 */
function expectedPermitted(from: TicketStatus, to: TicketStatus, roleKey: RoleKey): boolean {
  if (!isTransitionDeclared(from, to)) return false;

  const edge = TRANSITIONS[from].find((candidate) => candidate.to === to);

  if (edge?.permission === 'tickets:reopen') {
    return roleKey !== 'agent';
  }

  return true;
}

describe('ticket lifecycle matrix (SC-002)', () => {
  it.each(PAIRS)('$roleKey moving $from -> $to', async ({ from, to, roleKey }) => {
    const { user, agent } = await agentAs(roleKey);
    const customer = await seedCustomer();

    // The actor is the assignee, so the conditional part of tickets:close is
    // satisfied and this test measures the LIFECYCLE rather than ownership.
    // Ownership has its own test — see tickets/transitions.test.ts.
    const ticket = await seedTicket({
      customer,
      createdBy: user,
      assignee: user,
      status: from,
    });

    const response = await agent.post(`/api/tickets/${ticket.id}/transitions`).send({
      to,
      version: ticket.version,
      // Escalation must say why (FR-029). Supplied unconditionally so this test
      // measures the TABLE rather than payload validity — the reason
      // requirement has its own test in escalation.test.ts.
      reason: 'Raised for the lifecycle matrix.',
    });

    if (expectedPermitted(from, to, roleKey)) {
      expect(response.status).toBe(200);
      expect(response.body.status).toBe(to);
      return;
    }

    // Two distinct refusals, and the difference matters: 422 means the move is
    // not possible for anyone, 403 means it is not this caller's to make.
    expect([403, 422]).toContain(response.status);

    if (response.status === 422) {
      expect(response.body.error.code).toBe('TRANSITION_NOT_ALLOWED');
      // A refusal that names nothing leaves the user guessing (FR-017).
      expect(response.body.transition.allowed).toBeInstanceOf(Array);
      expect(response.body.transition.allowed).not.toContain(to);
    }

    const reloaded = await Ticket.findByPk(ticket.id);
    expect(reloaded?.status).toBe(from);
  });
});

describe('the lifecycle declaration is structurally sound', () => {
  it('every status appears as a `from` key', () => {
    // A status missing from TRANSITIONS would be a silent dead end by omission
    // rather than by decision.
    const missing = TICKET_STATUSES.filter((status) => !(status in TRANSITIONS));

    expect(missing).toEqual([]);
  });

  it('every `to` value is a declared status', () => {
    const declared = new Set<string>(TICKET_STATUSES);

    const unknown = Object.values(TRANSITIONS)
      .flat()
      .map((edge) => edge.to)
      .filter((to) => !declared.has(to));

    expect(unknown).toEqual([]);
  });

  it('every edge permission is a catalog key', () => {
    const catalog = new Set<string>(allPermissionKeys());

    const unknown = Object.values(TRANSITIONS)
      .flat()
      .map((edge) => edge.permission)
      .filter((permission) => !catalog.has(permission));

    expect(unknown).toEqual([]);
  });

  it('holds the constraints the requirements name', () => {
    // Spelled out rather than derived, because these are the specific claims
    // FR-018 through FR-030 make. If a future edit to the table breaks one,
    // this says which requirement it broke.
    expect(isTransitionDeclared('new', 'resolved')).toBe(false); // FR-018
    expect(isTransitionDeclared('new', 'closed')).toBe(false); // FR-018
    expect(isTransitionDeclared('open', 'closed')).toBe(false); // FR-019
    expect(isTransitionDeclared('resolved', 'closed')).toBe(true); // FR-019
    expect(isTransitionDeclared('escalated', 'resolved')).toBe(true); // FR-030
    expect(isTransitionDeclared('escalated', 'open')).toBe(true); // FR-031
    expect(isTransitionDeclared('closed', 'open')).toBe(true); // FR-020
  });

  it('permits exactly 13 of the 36 ordered pairs', () => {
    const permitted = TICKET_STATUSES.flatMap((from) =>
      TICKET_STATUSES.filter((to) => isTransitionDeclared(from, to)),
    );

    expect(TICKET_STATUSES.length ** 2).toBe(36);
    expect(permitted).toHaveLength(13);
  });
});

describe('reopening is a distinct authority (Clarifications Q2)', () => {
  async function closedTicket(owner: User, customer: Customer): Promise<Ticket> {
    return seedTicket({ customer, createdBy: owner, assignee: owner, status: 'closed' });
  }

  it('refuses an Agent, who holds tickets:transition but not tickets:reopen', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await closedTicket(user, await seedCustomer());

    const response = await agent
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'open', version: ticket.version });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a Supervisor, and the ticket keeps all its history (FR-022)', async () => {
    const owner = (await agentAs('agent')).user;
    const { agent: supervisor } = await agentAs('supervisor');
    const ticket = await closedTicket(owner, await seedCustomer());

    const before = await supervisor.get(`/api/tickets/${ticket.id}/history`);
    const countBefore = before.body.total as number;

    const response = await supervisor
      .post(`/api/tickets/${ticket.id}/transitions`)
      .send({ to: 'open', version: ticket.version });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('open');

    const after = await supervisor.get(`/api/tickets/${ticket.id}/history`);

    // Reopening CONTINUES a ticket; it does not start one. Nothing is removed.
    expect(after.body.total).toBeGreaterThan(countBefore);
  });

  it('does not offer a move the caller could not make', async () => {
    const { user, agent } = await agentAs('agent');
    const ticket = await closedTicket(user, await seedCustomer());

    const response = await agent.get(`/api/tickets/${ticket.id}/transitions`);

    expect(response.status).toBe(200);
    // The edge exists in the table, but not for this caller. Offering it would
    // be the interface promising authority it cannot deliver.
    expect(response.body.transitions).toEqual([]);
  });
});

describe('the transitions endpoint reflects the same table', () => {
  it('offers only Open from New', async () => {
    const { user, agent } = await agentAs('supervisor');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'new' });

    const response = await agent.get(`/api/tickets/${ticket.id}/transitions`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('new');
    expect(response.body.transitions).toEqual(['open']);
  });

  it('offers Open and Closed from Resolved to a Supervisor', async () => {
    const { user, agent } = await agentAs('supervisor');
    const ticket = await seedTicket({ createdBy: user, assignee: user, status: 'resolved' });

    const response = await agent.get(`/api/tickets/${ticket.id}/transitions`);

    expect(response.body.transitions.sort()).toEqual(['closed', 'open']);
  });

  it('offers nothing at all on a merged ticket', async () => {
    const { user, agent } = await agentAs('supervisor');
    const customer = await seedCustomer();
    const survivor = await seedTicket({ customer, createdBy: user, status: 'open' });
    const absorbed = await seedTicket({
      customer,
      createdBy: user,
      status: 'open',
      mergedInto: survivor,
    });

    const response = await agent.get(`/api/tickets/${absorbed.id}/transitions`);

    expect(response.body.transitions).toEqual([]);
  });
});
