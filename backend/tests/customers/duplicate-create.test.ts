import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DuplicateOverride } from '../../src/models/index.js';
import { AUDIT_ACTIONS } from '../../src/services/audit.service.js';
import { AuditLog } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { customerPayload, seedCustomer } from './helpers.js';

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
 * quickstart B3 / FR-017-FR-023 / SC-004.
 *
 * PLAN.md's Definition of done singles this out: duplicates must be "flagged
 * rather than silently created". A customer entered twice does not stay a local
 * problem — by Phase 3 their support history is split across two records with
 * no clean way to reunite it.
 */
describe('duplicate detection on create', () => {
  it('flags an identical phone number before creating anything', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({
      displayName: 'Existing Customer',
      contacts: [{ kind: 'phone', value: '01001234567' }],
    });

    const response = await agent.post('/api/customers').send(customerPayload());

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_CUSTOMER');
    expect(response.body.duplicates).toHaveLength(1);
    expect(response.body.duplicates[0].customer.displayName).toBe('Existing Customer');
    expect(response.body.duplicates[0].matchedOn).toBe('phone');

    // Nothing was created.
    const list = await agent.get('/api/customers');
    expect(list.body.total).toBe(1);
  });

  it('flags a DIFFERENTLY FORMATTED version of the same number', async () => {
    // The check the Definition of done rests on. A naive comparison passes the
    // identical case above and fails silently here.
    const { agent } = await agentAs('admin');
    await seedCustomer({ contacts: [{ kind: 'phone', value: '01001234567' }] });

    const response = await agent
      .post('/api/customers')
      .send(customerPayload({ contacts: [{ kind: 'phone', value: '+20 100 123 4567' }] }));

    expect(response.status).toBe(409);
    expect(response.body.duplicates[0].matchedOn).toBe('phone');
  });

  it('flags an identical email regardless of case', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({ contacts: [{ kind: 'email', value: 'ahmed@example.com' }] });

    const response = await agent
      .post('/api/customers')
      .send(customerPayload({ contacts: [{ kind: 'email', value: 'Ahmed@Example.COM' }] }));

    expect(response.status).toBe(409);
    expect(response.body.duplicates[0].matchedOn).toBe('email');
  });

  it('flags a match against a DEACTIVATED customer', async () => {
    // Otherwise a retired customer is silently recreated as a second record
    // (FR-019).
    const { agent } = await agentAs('admin');
    await seedCustomer({
      displayName: 'Retired Customer',
      contacts: [{ kind: 'phone', value: '01001234567' }],
      isActive: false,
    });

    const response = await agent.post('/api/customers').send(customerPayload());

    expect(response.status).toBe(409);
    expect(response.body.duplicates[0].customer.isActive).toBe(false);
  });

  it('returns ALL matches, not just the first', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({
      displayName: 'First',
      contacts: [{ kind: 'phone', value: '01001234567' }],
    });
    await seedCustomer({
      displayName: 'Second',
      contacts: [{ kind: 'email', value: 'shared@example.com' }],
    });

    const response = await agent.post('/api/customers').send(
      customerPayload({
        contacts: [
          { kind: 'phone', value: '01001234567' },
          { kind: 'email', value: 'shared@example.com' },
        ],
      }),
    );

    expect(response.status).toBe(409);
    expect(response.body.duplicates).toHaveLength(2);

    const names = response.body.duplicates.map(
      (d: { customer: { displayName: string } }) => d.customer.displayName,
    );
    expect(names).toContain('First');
    expect(names).toContain('Second');
  });

  it('carries duplicates as a SIBLING of error, leaving details untouched', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({ contacts: [{ kind: 'phone', value: '01001234567' }] });

    const response = await agent.post('/api/customers').send(customerPayload());

    // details[] is {field, message} pairs with a defined meaning — a customer
    // summary must not be crammed into it (research.md D5).
    expect(response.body.error.details).toEqual([]);
    expect(Array.isArray(response.body.duplicates)).toBe(true);
  });

  it('creates normally when nothing matches', async () => {
    const { agent } = await agentAs('admin');

    const response = await agent.post('/api/customers').send(customerPayload());

    expect(response.status).toBe(201);
    expect(response.body.displayName).toBe('Ahmed Hassan');
    // The raw value is returned, not the normalised form (rule 3).
    expect(response.body.contacts[0].raw).toBe('01001234567');
  });
});

/** quickstart B5 / FR-020 / SC-005. */
describe('duplicate override', () => {
  it('creates when acknowledged, and records the decision for later', async () => {
    const { agent } = await agentAs('admin');
    const existing = await seedCustomer({
      displayName: 'Household Member',
      contacts: [{ kind: 'phone', value: '01001234567' }],
    });

    const response = await agent
      .post('/api/customers')
      .send(customerPayload({ acknowledgeDuplicates: true }));

    // A shared household phone is legitimate — detection flags, it never
    // refuses outright (FR-023).
    expect(response.status).toBe(201);

    const overrides = await DuplicateOverride.findAll();
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.matched_customer_id).toBe(existing.id);
    expect(overrides[0]!.matched_on).toBe('phone');

    const audited = await AuditLog.findOne({
      where: { action: AUDIT_ACTIONS.CUSTOMER_DUPLICATE_OVERRIDDEN },
    });
    expect(audited).not.toBeNull();
  });

  it('writes one override row per match shown', async () => {
    const { agent } = await agentAs('admin');
    await seedCustomer({ contacts: [{ kind: 'phone', value: '01001234567' }] });
    await seedCustomer({ contacts: [{ kind: 'email', value: 'shared@example.com' }] });

    await agent.post('/api/customers').send(
      customerPayload({
        contacts: [
          { kind: 'phone', value: '01001234567' },
          { kind: 'email', value: 'shared@example.com' },
        ],
        acknowledgeDuplicates: true,
      }),
    );

    // The record of what was on screen must be complete, not summarised.
    expect(await DuplicateOverride.count()).toBe(2);
  });
});

/** quickstart B6 / FR-003. */
describe('contact requirement', () => {
  it('refuses a customer with no contact method', async () => {
    const { agent } = await agentAs('admin');

    const response = await agent.post('/api/customers').send(customerPayload({ contacts: [] }));

    expect(response.status).toBe(400);
    expect(response.body.error.details.some((d: { field: string }) => d.field === 'contacts')).toBe(
      true,
    );
  });

  it('refuses a customer with no name', async () => {
    const { agent } = await agentAs('admin');

    const response = await agent.post('/api/customers').send(customerPayload({ displayName: '' }));

    expect(response.status).toBe(400);
  });

  it('refuses a malformed email', async () => {
    const { agent } = await agentAs('admin');

    const response = await agent
      .post('/api/customers')
      .send(customerPayload({ contacts: [{ kind: 'email', value: 'not-an-email' }] }));

    expect(response.status).toBe(400);
  });
});
