import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_MENTIONS_PER_NOTE } from '../../src/services/ticket-note.service.js';
import { seedCustomer } from '../customers/helpers.js';
import { agentAs, createTestUser } from '../helpers/auth.js';
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

describe('mentions notify the person named (FR-043)', () => {
  it('notifies a mentioned colleague, identifying the ticket and the author', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const colleague = await agentAs('agent');

    await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: `Can you confirm the tenant, @[user:${colleague.user.id}]?` });

    const notifications = await colleague.agent.get('/api/notifications');

    expect(notifications.body.total).toBe(1);
    expect(notifications.body.items[0].type).toBe('note.mentioned');
    expect(notifications.body.items[0].actor.id).toBe(author.user.id);
    expect(notifications.body.items[0].ticket.id).toBe(ticket.id);
    expect(notifications.body.items[0].noteId).toBeTruthy();
  });

  it('produces exactly one notification when the same person is named twice (FR-039)', async () => {
    // The UNIQUE (note_id, user_id) constraint makes this true at the database
    // level; this test proves the path above it does not work around it.
    const { author, ticket } = await ticketWithAuthor();
    const colleague = await agentAs('agent');

    await author.agent.post(`/api/tickets/${ticket.id}/notes`).send({
      body: `@[user:${colleague.user.id}] — and again, @[user:${colleague.user.id}], please look.`,
    });

    const notifications = await colleague.agent.get('/api/notifications');

    expect(notifications.body.total).toBe(1);

    const notes = await author.agent.get(`/api/tickets/${ticket.id}/notes`);
    expect(notes.body.items[0].mentions).toHaveLength(1);
  });

  it('produces no notification for a self-mention (FR-040)', async () => {
    const { author, ticket } = await ticketWithAuthor();

    const created = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: `Reminder to @[user:${author.user.id}]: chase this tomorrow.` });

    expect(created.status).toBe(201);
    // The mention is still recorded — the text means something — it just does
    // not ping the person who wrote it.
    expect(created.body.mentions).toHaveLength(1);
    expect((await author.agent.get('/api/notifications')).body.total).toBe(0);
  });

  it('notifies each distinct person once when several are named', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const first = await agentAs('agent');
    const second = await agentAs('supervisor');

    await author.agent.post(`/api/tickets/${ticket.id}/notes`).send({
      body: `@[user:${first.user.id}] @[user:${second.user.id}] either of you seen this?`,
    });

    expect((await first.agent.get('/api/notifications')).body.total).toBe(1);
    expect((await second.agent.get('/api/notifications')).body.total).toBe(1);
  });

  it('renders a mention through the current name, not a stored one', async () => {
    // The reason the body stores `@[user:12]` rather than a display name: a
    // stored name goes stale on rename and misattributes after deactivation.
    const { author, ticket } = await ticketWithAuthor();
    const colleague = await agentAs('agent');
    const admin = await agentAs('admin');

    await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: `@[user:${colleague.user.id}] please look` });

    await colleague.user.reload();
    await admin.agent
      .patch(`/api/admin/users/${colleague.user.id}`)
      .send({ fullName: 'Renamed Person', version: colleague.user.version });

    const notes = await author.agent.get(`/api/tickets/${ticket.id}/notes`);

    expect(notes.body.items[0].mentions[0].fullName).toBe('Renamed Person');
  });

  it('keeps a mention attributed after the mentioned user is deactivated (FR-035)', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const colleague = await agentAs('agent');
    const admin = await agentAs('admin');

    await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: `@[user:${colleague.user.id}] please look` });

    await admin.agent.post(`/api/admin/users/${colleague.user.id}/deactivate`);

    const notes = await author.agent.get(`/api/tickets/${ticket.id}/notes`);

    // Still present, marked — so the interface can show it without the note
    // losing its meaning.
    expect(notes.body.items[0].mentions[0].id).toBe(colleague.user.id);
    expect(notes.body.items[0].mentions[0].isActive).toBe(false);
  });
});

describe('mentions are refused at composition time (FR-037)', () => {
  it('refuses a mention of a user who cannot view the ticket, naming them', async () => {
    // Accepting the note and silently dropping the notification would leave the
    // author believing they asked someone for help who was never told.
    const { author, ticket } = await ticketWithAuthor();
    const admin = await agentAs('admin');

    // A real user with a role stripped of tickets:view.
    const roles = await admin.agent.get('/api/admin/roles');
    const agentRole = roles.body.items.find((role: { key: string }) => role.key === 'agent');
    const outsider = await createTestUser({ roleKey: 'agent' });

    await admin.agent.put(`/api/admin/roles/${agentRole.id}/permissions`).send({
      permissions: agentRole.permissions.filter((key: string) => key !== 'tickets:view'),
      version: agentRole.version,
    });

    const response = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: `@[user:${outsider.id}] can you help?` });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MENTION_NOT_VISIBLE');
    // A sibling key, not details[] — the composer has to say WHICH person.
    expect(response.body.mentions.map((m: { id: number }) => m.id)).toContain(outsider.id);
  });

  it('refuses a mention of a deactivated user', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const colleague = await agentAs('agent');
    const admin = await agentAs('admin');

    await admin.agent.post(`/api/admin/users/${colleague.user.id}/deactivate`);

    const response = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: `@[user:${colleague.user.id}] are you there?` });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MENTION_NOT_VISIBLE');
  });

  it('refuses a mention of a user that does not exist', async () => {
    const { author, ticket } = await ticketWithAuthor();

    const response = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: '@[user:999999] hello?' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MENTION_NOT_VISIBLE');
  });

  it('refuses more mentions than the limit, stating the limit (FR-038)', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const ids: number[] = [];

    for (let index = 0; index <= MAX_MENTIONS_PER_NOTE; index += 1) {
      const user = await createTestUser({ roleKey: 'agent' });
      ids.push(user.id);
    }

    const response = await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: ids.map((id) => `@[user:${id}]`).join(' ') });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MENTION_LIMIT');
    expect(response.body.error.details[0].message).toContain(String(MAX_MENTIONS_PER_NOTE));
  });

  it('writes nothing at all when a mention is refused', async () => {
    // The refusal must be atomic. A note saved without its notification is
    // exactly the silent failure FR-037 exists to prevent.
    const { author, ticket } = await ticketWithAuthor();

    await author.agent
      .post(`/api/tickets/${ticket.id}/notes`)
      .send({ body: '@[user:999999] hello?' });

    expect((await author.agent.get(`/api/tickets/${ticket.id}/notes`)).body.total).toBe(0);
  });
});

describe('the mention picker offers only what the save would accept (FR-036)', () => {
  it('lists active users who can view the ticket', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const colleague = await agentAs('agent');

    const response = await author.agent.get(`/api/tickets/${ticket.id}/mentionable-users`);

    expect(response.status).toBe(200);
    expect(response.body.items.map((u: { id: number }) => u.id)).toContain(colleague.user.id);
  });

  it('filters by a search term', async () => {
    const { author, ticket } = await ticketWithAuthor();
    await createTestUser({ roleKey: 'agent', fullName: 'Distinctive Name' });

    const response = await author.agent.get(
      `/api/tickets/${ticket.id}/mentionable-users?q=Distinctive`,
    );

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].fullName).toBe('Distinctive Name');
  });

  it('omits deactivated users', async () => {
    const { author, ticket } = await ticketWithAuthor();
    const colleague = await agentAs('agent');
    const admin = await agentAs('admin');

    await admin.agent.post(`/api/admin/users/${colleague.user.id}/deactivate`);

    const response = await author.agent.get(`/api/tickets/${ticket.id}/mentionable-users`);

    expect(response.body.items.map((u: { id: number }) => u.id)).not.toContain(colleague.user.id);
  });

  it('is bounded rather than returning every user in the system', async () => {
    const { author, ticket } = await ticketWithAuthor();

    for (let index = 0; index < 25; index += 1) {
      await createTestUser({ roleKey: 'agent' });
    }

    const response = await author.agent.get(`/api/tickets/${ticket.id}/mentionable-users`);

    expect(response.body.items.length).toBeLessThanOrEqual(20);
  });
});
