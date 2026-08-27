import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

/** quickstart B7 / FR-010-FR-016 / SC-001. */
describe('customer search', () => {
  async function seedSet(): Promise<void> {
    await seedCustomer({
      displayName: 'Ahmed Hassan',
      company: 'Nile Trading',
      contacts: [
        { kind: 'phone', value: '01001234567' },
        { kind: 'email', value: 'ahmed@niletrading.example' },
      ],
    });
    await seedCustomer({
      displayName: 'Fatima Ali',
      company: 'Delta Logistics',
      contacts: [{ kind: 'phone', value: '01115555555' }],
    });
    await seedCustomer({
      displayName: 'شركة النيل للتجارة',
      company: 'Nile Trading',
      contacts: [{ kind: 'email', value: 'info@niletrading.example' }],
    });
  }

  it('finds by a partial name with one term, no field selector', async () => {
    const { agent } = await agentAs('admin');
    await seedSet();

    const response = await agent.get('/api/customers?search=Ahm');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].displayName).toBe('Ahmed Hassan');
    // The row explains itself — searching and getting unexplained results is
    // disorienting (contracts/customer-ui.md).
    expect(response.body.items[0].matchedOn).toBe('name');
  });

  it('finds by company', async () => {
    const { agent } = await agentAs('admin');
    await seedSet();

    const response = await agent.get('/api/customers?search=Nile');

    expect(response.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('finds by phone regardless of the formatting used on either side', async () => {
    const { agent } = await agentAs('admin');
    await seedSet();

    for (const term of ['01001234567', '+20 100 123 4567', '0100-123-4567']) {
      const response = await agent.get(`/api/customers?search=${encodeURIComponent(term)}`);

      expect(
        response.body.items.some((c: { displayName: string }) => c.displayName === 'Ahmed Hassan'),
      ).toBe(true);
    }
  });

  it('finds by email', async () => {
    const { agent } = await agentAs('admin');
    await seedSet();

    const response = await agent.get('/api/customers?search=ahmed@niletrading.example');

    expect(
      response.body.items.some((c: { displayName: string }) => c.displayName === 'Ahmed Hassan'),
    ).toBe(true);
  });

  it('finds an Arabic name by partial search', async () => {
    // The collation is utf8mb4_0900_ai_ci, so this needs no special handling —
    // but a future migration changing a charset would break it silently.
    const { agent } = await agentAs('admin');
    await seedSet();

    const response = await agent.get(`/api/customers?search=${encodeURIComponent('النيل')}`);

    expect(
      response.body.items.some(
        (c: { displayName: string }) => c.displayName === 'شركة النيل للتجارة',
      ),
    ).toBe(true);
  });

  it('returns an empty result rather than a misleading near-match', async () => {
    const { agent } = await agentAs('admin');
    await seedSet();

    const response = await agent.get('/api/customers?search=NobodyByThisName');

    expect(response.body.items).toHaveLength(0);
    expect(response.body.total).toBe(0);
  });

  it('excludes deactivated customers by default and includes them on request', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({ displayName: 'Retired Person', isActive: false });

    const byDefault = await agent.get('/api/customers');
    expect(
      byDefault.body.items.some((c: { displayName: string }) => c.displayName === 'Retired Person'),
    ).toBe(false);

    const including = await agent.get('/api/customers?isActive=all');
    expect(
      including.body.items.some((c: { displayName: string }) => c.displayName === 'Retired Person'),
    ).toBe(true);
  });

  it('clamps pageSize to 100 rather than rejecting it', async () => {
    const { agent } = await agentAs('admin');

    const response = await agent.get('/api/customers?pageSize=10000');

    expect(response.status).toBe(200);
    expect(response.body.pageSize).toBe(100);
  });

  it('never returns a normalised value where a raw one belongs', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({ contacts: [{ kind: 'phone', value: '+20 100 123 4567' }] });

    const response = await agent.get('/api/customers');

    // Raw is preserved exactly as typed (rule 3).
    expect(response.body.items[0].primaryPhone.raw).toBe('+20 100 123 4567');
    expect(response.body.items[0].primaryPhone.normalised).toBe('+201001234567');
  });
});

/** quickstart B8 / FR-052 / SC-013. */
describe('Arabic text round-trips exactly', () => {
  it('stores and returns Arabic names, addresses and companies byte-exact', async () => {
    const { agent } = await agentAs('admin');

    const displayName = 'محمد عبد الرحمن';
    const address = '١٥ شارع النيل، المعادي، القاهرة';
    const company = 'شركة النيل للتجارة';

    const created = await agent.post('/api/customers').send({
      displayName,
      company,
      address,
      contacts: [{ kind: 'phone', value: '01007777777' }],
    });

    expect(created.status).toBe(201);
    expect(created.body.displayName).toBe(displayName);
    expect(created.body.address).toBe(address);
    expect(created.body.company).toBe(company);

    const fetched = await agent.get(`/api/customers/${created.body.id}`);
    expect(fetched.body.displayName).toBe(displayName);
    expect(fetched.body.address).toBe(address);
  });
});
