import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DuplicateOverride } from '../../src/models/index.js';
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

/**
 * quickstart B4 / FR-021.
 *
 * THE TEST THE SPEC'S CHECKLIST FLAGGED AS EASY TO OVERLOOK.
 *
 * Editing a customer's contact into one another customer holds is the identical
 * problem to creating it that way — but it is a SECOND CODE PATH that the
 * creation tests never exercise. If the update path forgets to call the
 * detector, every test in duplicate-create.test.ts still passes.
 */
describe('duplicate detection on edit', () => {
  it('refuses an edit that moves a contact onto another customer', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({
      displayName: 'Existing Customer',
      contacts: [{ kind: 'phone', value: '01001234567' }],
    });
    const target = await seedCustomer({
      displayName: 'Target Customer',
      contacts: [{ kind: 'phone', value: '01009999999' }],
    });

    const loaded = await agent.get(`/api/customers/${target.id}`);

    const response = await agent.patch(`/api/customers/${target.id}`).send({
      contacts: [{ kind: 'phone', value: '01001234567' }],
      version: loaded.body.version,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_CUSTOMER');
    expect(response.body.duplicates[0].customer.displayName).toBe('Existing Customer');

    // The change must not have been applied.
    const after = await agent.get(`/api/customers/${target.id}`);
    expect(after.body.contacts[0].raw).toBe('01009999999');
  });

  it('applies the same formatting-independent matching as create', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({ contacts: [{ kind: 'phone', value: '+201001234567' }] });
    const target = await seedCustomer({ contacts: [{ kind: 'phone', value: '01009999999' }] });

    const loaded = await agent.get(`/api/customers/${target.id}`);

    const response = await agent.patch(`/api/customers/${target.id}`).send({
      contacts: [{ kind: 'phone', value: '0100-123-4567' }],
      version: loaded.body.version,
    });

    expect(response.status).toBe(409);
  });

  it('never flags a customer against ITSELF', async () => {
    // Saving a customer without changing their contacts must not refuse
    // because their own number already exists.
    const { agent } = await agentAs('admin');
    const target = await seedCustomer({ contacts: [{ kind: 'phone', value: '01001234567' }] });

    const loaded = await agent.get(`/api/customers/${target.id}`);

    const response = await agent.patch(`/api/customers/${target.id}`).send({
      displayName: 'Renamed',
      contacts: [{ kind: 'phone', value: '01001234567' }],
      version: loaded.body.version,
    });

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe('Renamed');
  });

  it('proceeds when acknowledged and records the override', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({ contacts: [{ kind: 'phone', value: '01001234567' }] });
    const target = await seedCustomer({ contacts: [{ kind: 'phone', value: '01009999999' }] });

    const loaded = await agent.get(`/api/customers/${target.id}`);

    const response = await agent.patch(`/api/customers/${target.id}`).send({
      contacts: [{ kind: 'phone', value: '01001234567' }],
      version: loaded.body.version,
      acknowledgeDuplicates: true,
    });

    expect(response.status).toBe(200);
    expect(await DuplicateOverride.count()).toBe(1);
  });

  it('refuses removing the last contact method', async () => {
    const { agent } = await agentAs('admin');
    const target = await seedCustomer();
    const loaded = await agent.get(`/api/customers/${target.id}`);

    const response = await agent
      .patch(`/api/customers/${target.id}`)
      .send({ contacts: [], version: loaded.body.version });

    expect(response.status).toBe(400);
  });
});

/** quickstart B14 / FR-045. */
describe('optimistic locking', () => {
  it('refuses a stale version rather than overwriting', async () => {
    const { agent } = await agentAs('admin');
    const target = await seedCustomer();
    const loaded = await agent.get(`/api/customers/${target.id}`);

    await agent
      .patch(`/api/customers/${target.id}`)
      .send({ displayName: 'First Write', version: loaded.body.version });

    const stale = await agent
      .patch(`/api/customers/${target.id}`)
      .send({ displayName: 'Second Write', version: loaded.body.version });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');

    const after = await agent.get(`/api/customers/${target.id}`);
    expect(after.body.displayName).toBe('First Write');
  });
});

/** quickstart B17 / Clarifications Q1 / SC-014. */
describe('deactivation is the only removal', () => {
  it('exposes no delete route at any path', async () => {
    const { agent } = await agentAs('admin');
    const target = await seedCustomer();

    // 404, not 403: the route does not exist. Phase 3 can treat a customer
    // reference as permanent because of this.
    expect((await agent.delete(`/api/customers/${target.id}`)).status).toBe(404);
    expect((await agent.delete('/api/customers')).status).toBe(404);
  });

  it('hides a deactivated customer from default results but keeps them reachable', async () => {
    const { agent } = await agentAs('admin');
    const target = await seedCustomer({ displayName: 'To Retire' });

    expect((await agent.post(`/api/customers/${target.id}/deactivate`)).status).toBe(204);

    const defaultList = await agent.get('/api/customers');
    expect(defaultList.body.items.some((c: { id: number }) => c.id === target.id)).toBe(false);

    // Still reachable by direct reference — every existing reference stays valid.
    expect((await agent.get(`/api/customers/${target.id}`)).status).toBe(200);

    const including = await agent.get('/api/customers?isActive=all');
    expect(including.body.items.some((c: { id: number }) => c.id === target.id)).toBe(true);
  });

  it('restores a customer on reactivation', async () => {
    const { agent } = await agentAs('admin');
    const target = await seedCustomer();

    await agent.post(`/api/customers/${target.id}/deactivate`);
    expect((await agent.post(`/api/customers/${target.id}/reactivate`)).status).toBe(204);

    const list = await agent.get('/api/customers');
    expect(list.body.items.some((c: { id: number }) => c.id === target.id)).toBe(true);
  });
});
