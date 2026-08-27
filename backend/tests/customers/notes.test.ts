import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Role, RolePermission } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { seedCustomer } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

async function grant(roleKey: string, permissionKey: string): Promise<void> {
  const role = await Role.findOne({ where: { key: roleKey } });
  await RolePermission.findOrCreate({
    where: { role_id: role!.id, permission_key: permissionKey },
  });
}

/** quickstart V4 / FR-024-FR-028. */
describe('customer notes', () => {
  it('records the author and time, and lists most recent first', async () => {
    const { user, agent } = await agentAs('agent');
    const customer = await seedCustomer();

    await agent.post(`/api/customers/${customer.id}/notes`).send({ body: 'First call' });
    await agent.post(`/api/customers/${customer.id}/notes`).send({ body: 'Second call' });

    const response = await agent.get(`/api/customers/${customer.id}/notes`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items[0].body).toBe('Second call');
    expect(response.body.items[0].author.id).toBe(user.id);
    expect(response.body.items[0].editedAt).toBeNull();
  });

  it('marks a note as edited rather than letting it change silently', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const created = await agent
      .post(`/api/customers/${customer.id}/notes`)
      .send({ body: 'Original' });

    const updated = await agent
      .patch(`/api/customers/${customer.id}/notes/${created.body.id}`)
      .send({ body: 'Corrected' });

    expect(updated.status).toBe(200);
    expect(updated.body.body).toBe('Corrected');
    // A silently rewritten note is worse than no note (FR-026).
    expect(updated.body.editedAt).not.toBeNull();
  });

  it("refuses to edit someone else's note without notes:manage", async () => {
    const author = await agentAs('agent');
    const other = await agentAs('agent');
    const customer = await seedCustomer();

    const created = await author.agent
      .post(`/api/customers/${customer.id}/notes`)
      .send({ body: 'Author wrote this' });

    const response = await other.agent
      .patch(`/api/customers/${customer.id}/notes/${created.body.id}`)
      .send({ body: 'Someone else rewrote it' });

    expect(response.status).toBe(403);

    // And the note is unchanged.
    const list = await author.agent.get(`/api/customers/${customer.id}/notes`);
    expect(list.body.items[0].body).toBe('Author wrote this');
  });

  it("allows editing someone else's note WITH notes:manage", async () => {
    const author = await agentAs('agent');
    await grant('supervisor', 'customers:view');
    await grant('supervisor', 'notes:create');
    const supervisor = await agentAs('supervisor');
    const customer = await seedCustomer();

    const created = await author.agent
      .post(`/api/customers/${customer.id}/notes`)
      .send({ body: 'Author wrote this' });

    const response = await supervisor.agent
      .patch(`/api/customers/${customer.id}/notes/${created.body.id}`)
      .send({ body: 'Supervisor corrected it' });

    expect(response.status).toBe(200);
  });

  it("refuses to delete someone else's note without notes:manage", async () => {
    const author = await agentAs('agent');
    const other = await agentAs('agent');
    const customer = await seedCustomer();

    const created = await author.agent
      .post(`/api/customers/${customer.id}/notes`)
      .send({ body: 'Keep me' });

    expect(
      (await other.agent.delete(`/api/customers/${customer.id}/notes/${created.body.id}`)).status,
    ).toBe(403);
  });

  it('lets an author delete their own note', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const created = await agent.post(`/api/customers/${customer.id}/notes`).send({ body: 'Mine' });

    expect(
      (await agent.delete(`/api/customers/${customer.id}/notes/${created.body.id}`)).status,
    ).toBe(204);
  });

  it('shows every note to anyone who may view the customer', async () => {
    // No private or supervisor-only notes exist (Clarifications Q2).
    const author = await agentAs('agent');
    const reader = await agentAs('agent');
    const customer = await seedCustomer();

    await author.agent.post(`/api/customers/${customer.id}/notes`).send({ body: 'Visible' });

    const response = await reader.agent.get(`/api/customers/${customer.id}/notes`);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].body).toBe('Visible');
  });

  it('refuses an empty note', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    expect(
      (await agent.post(`/api/customers/${customer.id}/notes`).send({ body: '   ' })).status,
    ).toBe(400);
  });

  it('pages rather than returning every note', async () => {
    const { agent } = await agentAs('agent');
    const customer = await seedCustomer();

    const response = await agent.get(`/api/customers/${customer.id}/notes?pageSize=10000`);

    expect(response.body.pageSize).toBe(100);
  });

  it('404s for a customer that does not exist', async () => {
    const { agent } = await agentAs('agent');

    expect((await agent.get('/api/customers/999999/notes')).status).toBe(404);
  });
});
