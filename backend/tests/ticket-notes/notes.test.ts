import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedCustomer } from '../customers/helpers.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
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

async function ticketWithAuthor() {
  const author = await agentAs('agent');
  const customer = await seedCustomer();
  const ticket = await seedTicket({
    customer,
    createdBy: author.user,
    assignee: author.user,
    status: 'open',
  });

  return { author, ticket };
}

describe('internal notes on a ticket', () => {
  it('records the author and the time', async () => {
    const { author, ticket } = await ticketWithAuthor();

    const response = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: 'Checked the logs; nothing obvious yet.' });

    expect(response.status).toBe(201);
    expect(response.body.author.id).toBe(author.user.id);
    expect(response.body.editedAt).toBeNull();
    expect(response.body.createdAt).toBeTruthy();
  });

  it('lists notes oldest first, so a ticket reads as a story', async () => {
    const { author, ticket } = await ticketWithAuthor();

    await author.agent.post(`/api/tickets/${ticket.id}/notes`).send({ body: 'First' });
    await author.agent.post(`/api/tickets/${ticket.id}/notes`).send({ body: 'Second' });

    const response = await author.agent.get(`/api/tickets/${ticket.id}/notes`);

    expect(response.body.items.map((note: { body: string }) => note.body)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('pages rather than loading the whole conversation', async () => {
    const { author, ticket } = await ticketWithAuthor();

    for (let index = 0; index < 4; index += 1) {
      await author.agent.post(`/api/tickets/${ticket.id}/notes`).send({ body: `Note ${index}` });
    }

    const response = await author.agent.get(`/api/tickets/${ticket.id}/notes?pageSize=2`);

    expect(response.body.items).toHaveLength(2);
    expect(response.body.total).toBe(4);
  });

  it('stores and returns Arabic exactly as entered', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const body = 'راجعت السجلات ولم أجد سببًا واضحًا حتى الآن.';

    const created = await author.agent.post(`/api/tickets/${ticket.id}/notes`).send({ body });

    expect(created.body.body).toBe(body);

    const listed = await author.agent.get(`/api/tickets/${ticket.id}/notes`);
    expect(listed.body.items[0].body).toBe(body);
  });

  it('refuses an empty note', async () => {
    const { author, ticket } = await ticketWithAuthor();

    const response = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('records that a note happened in the ticket history, without its body', async () => {
    // The history is a change log, not a second copy of the conversation
    // (FR-078). Someone reading it should be told a conversation exists and go
    // read it, not have it interleaved with field changes.
    const { author, ticket } = await ticketWithAuthor();
    const body = 'Something the history must not duplicate.';

    await author.agent.post(`/api/tickets/${ticket.id}/notes`).send({ body });

    const history = await author.agent.get(`/api/tickets/${ticket.id}/history`);
    const entry = history.body.items.find(
      (item: { event: string }) => item.event === 'ticket.note.added',
    );

    expect(entry).toBeDefined();
    expect(JSON.stringify(history.body)).not.toContain(body);
  });

  it('keeps a note readable and attributed after its author is deactivated', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const admin = await agentAs('admin');
    const reader = await agentAs('supervisor');

    await author.agent.post(`/api/tickets/${ticket.id}/notes`).send({ body: 'Still legible' });
    await admin.agent.post(`/api/admin/users/${author.user.id}/deactivate`);

    const response = await reader.agent.get(`/api/tickets/${ticket.id}/notes`);

    expect(response.body.items[0].body).toBe('Still legible');
    expect(response.body.items[0].author.id).toBe(author.user.id);
    expect(response.body.items[0].author.isActive).toBe(false);
  });
});

/**
 * ticket_notes:manage is conditional — the route gate is ticket_notes:create,
 * and the service demands manage only when the note belongs to someone else.
 * The permission matrix cannot express that and defers here
 * (authorization.matrix.test.ts, CONDITIONAL_PERMISSIONS).
 */
describe('editing notes (FR-033, FR-034)', () => {
  it('lets an author edit their own note and marks it edited', async () => {
    const { author, ticket } = await ticketWithAuthor();

    const created = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: 'Original' });

    const response = await author.agent
      .patch(`/api/tickets/${ticket.id}/notes/${created.body.id}`)
      .send({ body: 'Corrected' });

    expect(response.status).toBe(200);
    expect(response.body.body).toBe('Corrected');
    // A silently rewritten note is worse than no note.
    expect(response.body.editedAt).not.toBeNull();
  });

  it('refuses an agent editing another agent’s note', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const other = await agentAs('agent');

    const created = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: 'Mine' });

    const response = await other.agent
      .patch(`/api/tickets/${ticket.id}/notes/${created.body.id}`)
      .send({ body: 'Not yours to change' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a supervisor holding ticket_notes:manage to edit another user’s note', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const supervisor = await agentAs('supervisor');

    const created = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: 'Contains something that must come out' });

    const response = await supervisor.agent
      .patch(`/api/tickets/${ticket.id}/notes/${created.body.id}`)
      .send({ body: 'Redacted by a supervisor' });

    expect(response.status).toBe(200);
    expect(response.body.editedAt).not.toBeNull();
  });

  it('does not mark a note edited when the text is unchanged', async () => {
    const { author, ticket } = await ticketWithAuthor();

    const created = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: 'Unchanged' });

    const response = await author.agent
      .patch(`/api/tickets/${ticket.id}/notes/${created.body.id}`)
      .send({ body: 'Unchanged' });

    expect(response.body.editedAt).toBeNull();
  });

  it('404s for a note that belongs to a different ticket', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const customer = await seedCustomer();
    const elsewhere = await seedTicket({ customer, createdBy: author.user, status: 'open' });

    const created = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: 'Belongs to the first ticket' });

    const response = await author.agent
      .patch(`/api/tickets/${elsewhere.id}/notes/${created.body.id}`)
      .send({ body: 'Wrong ticket' });

    expect(response.status).toBe(404);
  });

  it('offers no delete route at all', async () => {
    const { author, ticket } = await ticketWithAuthor();

    const created = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: 'Permanent' });

    // A note is part of the record, like everything else in this project.
    const response = await author.agent.delete(
      `/api/tickets/${ticket.id}/notes/${created.body.id}`,
    );

    expect(response.status).toBe(404);
  });
});
