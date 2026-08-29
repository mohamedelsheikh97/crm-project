import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog, Ticket } from '../../src/models/index.js';
import { toReference } from '../../src/tickets/reference.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs, createTestUser } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedTicket } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('merging a duplicate (US6)', () => {
  it('marks the absorbed ticket as a redirect', async () => {
    const { user, agent } = await agentAs('supervisor');
    const customer = await seedCustomer();
    const survivor = await seedTicket({ createdBy: user, customer, status: 'open' });
    const absorbed = await seedTicket({ createdBy: user, customer, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${absorbed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: absorbed.version });

    expect(response.status).toBe(200);
    expect(response.body.mergedIntoTicketId).toBe(survivor.id);
    expect(response.body.survivor.id).toBe(survivor.id);
    expect(response.body.survivor.reference).toBe(toReference(survivor.id));
  });

  it('refuses an Agent', async () => {
    const { user, agent } = await agentAs('agent');
    const survivor = await seedTicket({ createdBy: user, status: 'open' });
    const absorbed = await seedTicket({ createdBy: user, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${absorbed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: absorbed.version });

    expect(response.status).toBe(403);
  });

  it('refuses a self-merge', async () => {
    const { user, agent } = await agentAs('supervisor');
    const ticket = await seedTicket({ createdBy: user, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${ticket.id}/merge`)
      .send({ intoTicketId: ticket.id, version: ticket.version });

    expect(response.status).toBe(400);
  });

  it('refuses merging into a closed ticket', async () => {
    const { user, agent } = await agentAs('supervisor');
    const survivor = await seedTicket({ createdBy: user, status: 'closed' });
    const absorbed = await seedTicket({ createdBy: user, status: 'open' });

    const response = await agent
      .post(`/api/tickets/${absorbed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: absorbed.version });

    expect(response.status).toBe(400);
  });

  it('refuses a merge that would create a cycle', async () => {
    const { user, agent } = await agentAs('supervisor');
    const a = await seedTicket({ createdBy: user, status: 'open' });
    const b = await seedTicket({ createdBy: user, status: 'open' });

    await agent.post(`/api/tickets/${b.id}/merge`).send({
      intoTicketId: a.id,
      version: b.version,
    });

    const reloadedA = await Ticket.findByPk(a.id);

    // B already resolves to A. Merging A into B would create a loop no reader
    // could follow out of.
    const response = await agent
      .post(`/api/tickets/${a.id}/merge`)
      .send({ intoTicketId: b.id, version: reloadedA!.version });

    expect(response.status).toBe(400);
  });

  it('refuses merging an already-merged ticket and names its survivor', async () => {
    const { user, agent } = await agentAs('supervisor');
    const survivor = await seedTicket({ createdBy: user, status: 'open' });
    const other = await seedTicket({ createdBy: user, status: 'open' });
    const absorbed = await seedTicket({
      createdBy: user,
      status: 'open',
      mergedInto: survivor,
    });

    const response = await agent
      .post(`/api/tickets/${absorbed.id}/merge`)
      .send({ intoTicketId: other.id, version: absorbed.version });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TICKET_MERGED');
    expect(response.body.merged.survivorId).toBe(survivor.id);
  });
});

/**
 * THE THREE-TICKET CHAIN.
 *
 * A merge implementation that only ever follows one hop looks completely
 * correct until the second merge. This is the test that separates the two.
 */
describe('merge chains resolve to one survivor (FR-045)', () => {
  it('resolves B through A to C', async () => {
    const { user, agent } = await agentAs('supervisor');
    const a = await seedTicket({ createdBy: user, status: 'open', subject: 'A' });
    const b = await seedTicket({ createdBy: user, status: 'open', subject: 'B' });
    const c = await seedTicket({ createdBy: user, status: 'open', subject: 'C' });

    // B -> A
    const first = await agent
      .post(`/api/tickets/${b.id}/merge`)
      .send({ intoTicketId: a.id, version: b.version });
    expect(first.status).toBe(200);

    // A -> C
    const reloadedA = await Ticket.findByPk(a.id);
    const second = await agent
      .post(`/api/tickets/${a.id}/merge`)
      .send({ intoTicketId: c.id, version: reloadedA!.version });
    expect(second.status).toBe(200);

    // B still points directly at A, but resolves THROUGH it to C.
    const reopened = await agent.get(`/api/tickets/${b.id}`);

    expect(reopened.body.mergedIntoTicketId).toBe(a.id);
    expect(reopened.body.survivor.id).toBe(c.id);
    expect(reopened.body.survivor.reference).toBe(toReference(c.id));
  });

  it('names the final survivor when refusing work on the first link', async () => {
    const { user, agent } = await agentAs('supervisor');
    const a = await seedTicket({ createdBy: user, status: 'open' });
    const b = await seedTicket({ createdBy: user, status: 'open' });
    const c = await seedTicket({ createdBy: user, status: 'open' });

    await agent.post(`/api/tickets/${b.id}/merge`).send({
      intoTicketId: a.id,
      version: b.version,
    });

    const reloadedA = await Ticket.findByPk(a.id);
    await agent.post(`/api/tickets/${a.id}/merge`).send({
      intoTicketId: c.id,
      version: reloadedA!.version,
    });

    const reloadedB = await Ticket.findByPk(b.id);
    const response = await agent
      .patch(`/api/tickets/${b.id}`)
      .send({ subject: 'Nope', version: reloadedB!.version });

    // Sending the user to A would send them to another redirect.
    expect(response.status).toBe(422);
    expect(response.body.merged.survivorId).toBe(c.id);
  });
});

describe('a merged ticket is unworkable through EVERY route (FR-043)', () => {
  async function mergedPair() {
    const { user, agent } = await agentAs('supervisor');
    const survivor = await seedTicket({ createdBy: user, status: 'open' });
    const absorbed = await seedTicket({ createdBy: user, status: 'open', mergedInto: survivor });
    const target = await createTestUser({ roleKey: 'agent' });

    return { user, agent, survivor, absorbed, target };
  }

  it('refuses an edit', async () => {
    const { agent, absorbed } = await mergedPair();

    const response = await agent
      .patch(`/api/tickets/${absorbed.id}`)
      .send({ subject: 'Changed', version: absorbed.version });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TICKET_MERGED');
  });

  it('refuses a transition', async () => {
    const { agent, absorbed } = await mergedPair();

    const response = await agent
      .post(`/api/tickets/${absorbed.id}/transitions`)
      .send({ to: 'pending', version: absorbed.version });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TICKET_MERGED');
  });

  it('refuses an assignment', async () => {
    const { agent, absorbed, target } = await mergedPair();

    const response = await agent
      .put(`/api/tickets/${absorbed.id}/assignee`)
      .send({ userId: target.id, version: absorbed.version });

    expect(response.status).toBe(422);
  });

  it('refuses a link', async () => {
    const { agent, absorbed, survivor } = await mergedPair();

    const response = await agent
      .post(`/api/tickets/${absorbed.id}/links`)
      .send({ linkedTicketId: survivor.id });

    // The guard lives in the service, so a route added later inherits it
    // without anyone remembering to add it.
    expect(response.status).toBe(422);
  });

  it('still READS, because a redirect that 404s helps nobody', async () => {
    const { agent, absorbed } = await mergedPair();

    const response = await agent.get(`/api/tickets/${absorbed.id}`);

    expect(response.status).toBe(200);
    expect(response.body.survivor).not.toBeNull();
  });
});

describe('merge history and audit', () => {
  it('spans the chain, labelled by the ticket each entry happened to (FR-041)', async () => {
    const { user, agent } = await agentAs('supervisor');
    const survivor = await seedTicket({ createdBy: user, status: 'open', subject: 'Survivor' });
    const absorbed = await seedTicket({ createdBy: user, status: 'open', subject: 'Absorbed' });

    await agent
      .patch(`/api/tickets/${absorbed.id}`)
      .send({ subject: 'Absorbed, edited', version: absorbed.version });

    const reloaded = await Ticket.findByPk(absorbed.id);
    await agent
      .post(`/api/tickets/${absorbed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: reloaded!.version });

    const history = await agent.get(`/api/tickets/${survivor.id}/history`);
    const ticketIds = new Set(
      history.body.items.map((item: { ticketId: number }) => item.ticketId),
    );

    // The absorbed ticket's own edit now appears on the survivor's timeline,
    // still labelled with where it happened. Rewriting ticket_id would have
    // been simpler and would have destroyed exactly that.
    expect(ticketIds.has(absorbed.id)).toBe(true);
    expect(ticketIds.has(survivor.id)).toBe(true);
  });

  it('records the merge on both tickets', async () => {
    const { user, agent } = await agentAs('supervisor');
    const survivor = await seedTicket({ createdBy: user, status: 'open' });
    const absorbed = await seedTicket({ createdBy: user, status: 'open' });

    await agent
      .post(`/api/tickets/${absorbed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: absorbed.version });

    const history = await agent.get(`/api/tickets/${survivor.id}/history`);
    const events = history.body.items.map((item: { event: string }) => item.event);

    expect(events).toContain('ticket.merged');
    expect(events).toContain('ticket.merge.received');
  });

  it('emits BOTH record.deleted and ticket.merged (FR-053)', async () => {
    const { user, agent } = await agentAs('supervisor');
    const survivor = await seedTicket({ createdBy: user, status: 'open' });
    const absorbed = await seedTicket({ createdBy: user, status: 'open' });

    await agent
      .post(`/api/tickets/${absorbed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: absorbed.version });

    // record.deleted is the security-relevant fact — a record a user created is
    // permanently out of active use. ticket.merged is the domain detail. This
    // is the first caller record.deleted has had since Phase 1 defined it.
    const deleted = await AuditLog.findAll({ where: { action: 'record.deleted' } });
    expect(deleted).toHaveLength(1);
    expect(deleted[0].target_id).toBe(String(absorbed.id));

    expect(await AuditLog.count({ where: { action: 'ticket.merged' } })).toBe(1);
  });

  it('retains the absorbed row rather than deleting it', async () => {
    const { user, agent } = await agentAs('supervisor');
    const survivor = await seedTicket({ createdBy: user, status: 'open' });
    const absorbed = await seedTicket({ createdBy: user, status: 'open' });

    await agent
      .post(`/api/tickets/${absorbed.id}/merge`)
      .send({ intoTicketId: survivor.id, version: absorbed.version });

    // The deletion is of its workability, not of its bytes. Every reference to
    // it keeps resolving.
    expect(await Ticket.findByPk(absorbed.id)).not.toBeNull();
  });
});
