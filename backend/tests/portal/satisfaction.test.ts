import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { reset as resetRateLimit } from '../../src/lib/rate-limit.js';
import { Ticket, TicketSatisfaction, TicketSla } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

import { buildPortalWorld, portalAgent, type PortalWorld } from './fixtures.js';

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
 * POST-RESOLUTION SATISFACTION (Phase 8, User Story 7, FR-047 - FR-055,
 * SC-016 - SC-018).
 *
 * The interesting test in this file is the concurrent one. `at most one per
 * ticket` is the unique index on `ticket_id`, and the reason it is an index
 * rather than a service check is that a customer double-clicking a submit button
 * is not a hypothetical — it is the commonest way any form gets submitted twice.
 * A check-then-insert passes every sequential test and still admits two rows.
 */

describe('rating a resolved request', () => {
  let world: PortalWorld;

  beforeEach(async () => {
    world = await buildPortalWorld();
    await Ticket.update({ status: 'resolved' }, { where: { id: world.ticketA.id } });
  });

  it('stores the score, the comment, and the date', async () => {
    const response = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/satisfaction`)
      .send({ score: 4, comment: 'Took a while but sorted.' });

    expect(response.status).toBe(201);
    expect(response.body.score).toBe(4);

    const row = await TicketSatisfaction.findOne({ where: { ticket_id: world.ticketA.id } });
    expect(row?.score).toBe(4);
    expect(row?.comment).toBe('Took a while but sorted.');
    expect(row?.submitted_by_contact_id).toBe(world.a.contactId);
  });

  it('is not offered, and is refused, before the request is resolved (FR-047)', async () => {
    await Ticket.update({ status: 'open' }, { where: { id: world.ticketA.id } });

    const view = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}`,
    );
    expect(view.body.ratingOffered).toBe(false);

    const response = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/satisfaction`)
      .send({ score: 5 });

    // The screen and the endpoint read the same declaration, so a stale page
    // cannot succeed where the fresh one would not have offered.
    expect(response.status).toBe(400);
    expect(await TicketSatisfaction.count()).toBe(0);
  });

  it('refuses a score outside the declared scale', async () => {
    for (const score of [0, 6, -1, 2.5, 'five', null]) {
      const response = await portalAgent(world.a.accessToken)
        .post(`/api/portal/tickets/${world.ticketA.reference}/satisfaction`)
        .send({ score });

      expect(response.status).toBe(400);
    }

    expect(await TicketSatisfaction.count()).toBe(0);
  });

  it('reports the second submission and keeps the first (FR-049)', async () => {
    await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/satisfaction`)
      .send({ score: 5, comment: 'First answer.' });

    const second = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/satisfaction`)
      .send({ score: 1, comment: 'Changed my mind.' });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_RECORDED');

    const rows = await TicketSatisfaction.findAll({ where: { ticket_id: world.ticketA.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBe(5);
    expect(rows[0]?.comment).toBe('First answer.');
  });

  /**
   * THE ONE THAT JUSTIFIES THE UNIQUE INDEX (SC-016).
   *
   * Both requests are in flight before either has finished, which is what a
   * double-click actually produces. A service-level check would let both through.
   */
  it('survives concurrent submission with exactly one row', async () => {
    const submit = () =>
      portalAgent(world.a.accessToken)
        .post(`/api/portal/tickets/${world.ticketA.reference}/satisfaction`)
        .send({ score: 3, comment: 'Double-clicked.' });

    const results = await Promise.all([submit(), submit(), submit()]);

    const created = results.filter((response) => response.status === 201);
    const refused = results.filter((response) => response.status === 409);

    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(2);
    expect(await TicketSatisfaction.count({ where: { ticket_id: world.ticketA.id } })).toBe(1);
  });

  it('cannot be submitted on a request this contact does not own (FR-055)', async () => {
    await Ticket.update({ status: 'resolved' }, { where: { id: world.ticketB.id } });

    const response = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketB.reference}/satisfaction`)
      .send({ score: 1 });

    // 404, identical to a nonexistent reference: the alternative confirms that a
    // colleague's request exists.
    expect(response.status).toBe(404);
    expect(await TicketSatisfaction.count()).toBe(0);
  });
});

describe('a reopened request does not gain a second score (FR-054)', () => {
  it('the first response stands', async () => {
    const world = await buildPortalWorld();
    await Ticket.update({ status: 'resolved' }, { where: { id: world.ticketA.id } });

    await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/satisfaction`)
      .send({ score: 2, comment: 'Not great.' });

    // Reopen by replying, then resolve again — the real journey, not a direct
    // status write.
    await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/replies`)
      .send({ body: 'It has come back.' });

    await Ticket.update({ status: 'resolved' }, { where: { id: world.ticketA.id } });

    const again = await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/satisfaction`)
      .send({ score: 5, comment: 'Better this time.' });

    expect(again.status).toBe(409);

    const rows = await TicketSatisfaction.findAll({ where: { ticket_id: world.ticketA.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBe(2);
  });
});

describe('ignoring the invitation costs nothing (FR-051, SC-018)', () => {
  it('creates no record and changes nothing about the ticket', async () => {
    const world = await buildPortalWorld();

    await TicketSla.create({
      ticket_id: world.ticketA.id,
      policy_id: null,
      started_at: new Date(),
      response_target_at: new Date(Date.now() + 3_600_000),
      resolution_target_at: new Date(Date.now() + 7_200_000),
    });

    await Ticket.update({ status: 'resolved' }, { where: { id: world.ticketA.id } });

    const before = await Ticket.findByPk(world.ticketA.id);
    const slaBefore = await TicketSla.findByPk(world.ticketA.id);

    // Open the request — which is where the invitation appears — and do nothing.
    const view = await portalAgent(world.a.accessToken).get(
      `/api/portal/tickets/${world.ticketA.reference}`,
    );

    expect(view.body.ratingOffered).toBe(true);
    expect(view.body.satisfaction).toBeNull();

    // NOTHING was created by being asked. There is no invitation record, no
    // reminder, and no column recording that we asked — which is what makes
    // "ignored" free.
    expect(await TicketSatisfaction.count()).toBe(0);

    const after = await Ticket.findByPk(world.ticketA.id);
    expect(after?.status).toBe(before?.status);

    const slaAfter = await TicketSla.findByPk(world.ticketA.id);
    expect(slaAfter?.response_target_at?.getTime()).toBe(slaBefore?.response_target_at?.getTime());
  });
});

describe('staff see the rating on the ticket (FR-053, SC-017)', () => {
  it('shows the score, the comment, and the date it was given', async () => {
    const world = await buildPortalWorld();
    await Ticket.update({ status: 'resolved' }, { where: { id: world.ticketA.id } });

    await portalAgent(world.a.accessToken)
      .post(`/api/portal/tickets/${world.ticketA.reference}/satisfaction`)
      .send({ score: 4, comment: 'Fine in the end.' });

    const { agent } = await agentAs('admin');
    const detail = await agent.get(`/api/tickets/${world.ticketA.id}`);

    expect(detail.body.satisfaction).toEqual({
      score: 4,
      comment: 'Fine in the end.',
      submittedAt: expect.any(String),
    });
  });

  it('reports null for an unrated ticket, without saying whether we asked', async () => {
    const world = await buildPortalWorld();
    const { agent } = await agentAs('admin');

    const detail = await agent.get(`/api/tickets/${world.ticketA.id}`);

    expect(detail.body.satisfaction).toBeNull();
  });
});
