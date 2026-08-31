import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { normaliseContact } from '../../src/lib/phone.js';
import { Customer, CustomerContact } from '../../src/models/index.js';
import { CHANNELS } from '../../src/models/message.model.js';
import * as duplicateService from '../../src/services/duplicate.service.js';
import * as identityService from '../../src/services/identity.service.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

async function seedCustomerWith(
  kind: 'email' | 'phone',
  value: string,
  name = 'Known Customer',
): Promise<Customer> {
  const customer = await Customer.create({
    display_name: name,
    company: null,
    address: null,
    is_active: true,
    created_by_user_id: null,
  });

  await CustomerContact.create({
    customer_id: customer.id,
    kind,
    value_raw: value,
    value_normalised: normaliseContact(kind, value),
    is_primary: true,
  });

  return customer;
}

/**
 * US2, Clarifications Q2 — an unrecognised sender creates a provisional
 * customer (FR-014a-FR-014d, SC-016).
 */
describe('ambiguity is never guessed (FR-015)', () => {
  it('reports ambiguity and creates nothing when two customers share an address', async () => {
    const first = await seedCustomerWith('email', 'shared@example.com', 'First');
    const second = await seedCustomerWith('email', 'shared@example.com', 'Second');

    const outcome = await identityService.resolve(CHANNELS.EMAIL, 'shared@example.com');

    expect(outcome).toEqual({
      kind: 'ambiguous',
      customerIds: [first.id, second.id].sort((a, b) => a - b),
    });

    // Crucially: no third customer was invented to escape the ambiguity.
    expect(await Customer.count()).toBe(2);
  });

  it('attaches to the earliest match and flags it, rather than losing the message', async () => {
    const first = await seedCustomerWith('phone', '+201001234567', 'First');
    await seedCustomerWith('phone', '+201001234567', 'Second');

    const result = await identityService.resolveOrCreate(CHANNELS.SMS, '+201001234567');

    // Not lost, not silently merged, and flagged so a person can decide.
    expect(result.customerId).toBe(first.id);
    expect(result.isAmbiguous).toBe(true);
    expect(result.created).toBe(false);
    expect(result.ambiguousCustomerIds).toHaveLength(2);
    expect(await Customer.count()).toBe(2);
  });
});

describe('provisional customers (Clarifications Q2)', () => {
  it('creates one from an unrecognised sender, marked unverified', async () => {
    const result = await identityService.resolveOrCreate(CHANNELS.EMAIL, 'stranger@example.com');

    expect(result.created).toBe(true);

    const customer = await Customer.findByPk(result.customerId);

    expect(customer?.is_provisional).toBe(true);
    // No creator: the system made this record, not a person (research D9).
    expect(customer?.created_by_user_id).toBeNull();
    // The raw sender, not "Unknown sender 47" — an agent needs something they
    // can recognise and search for.
    expect(customer?.display_name).toBe('stranger@example.com');
  });

  it('does not create a SECOND provisional customer for the same sender', async () => {
    // The contact row written alongside the customer is what makes the next
    // message resolve normally. Without it, every message from a stranger
    // would mint another record.
    const first = await identityService.resolveOrCreate(CHANNELS.EMAIL, 'stranger@example.com');
    const second = await identityService.resolveOrCreate(CHANNELS.EMAIL, 'stranger@example.com');

    expect(second.customerId).toBe(first.customerId);
    expect(second.created).toBe(false);
    expect(await Customer.count()).toBe(1);
  });

  it('matches the same sender written differently on the second message', async () => {
    const first = await identityService.resolveOrCreate(CHANNELS.SMS, '+20 100 123 4567');
    const second = await identityService.resolveOrCreate(CHANNELS.SMS, '01001234567');

    expect(second.customerId).toBe(first.customerId);
    expect(await Customer.count()).toBe(1);
  });

  it('is offered for merge by Phase 2 duplicate detection, not a second mechanism', async () => {
    // FR-014c. The whole point of a flag rather than a separate table: the
    // machinery Phase 2 already built finds it.
    const real = await seedCustomerWith('email', 'hala@example.com', 'Hala Ahmed');

    // A stranger writes from a number nobody has recorded yet.
    const provisional = await identityService.resolveOrCreate(CHANNELS.SMS, '+201001234567');

    // Later, someone adds that number to the real customer's record.
    const matches = await duplicateService.findDuplicates({
      contacts: [{ kind: 'phone', value: '+201001234567' }],
      excludeCustomerId: real.id,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.customer.id).toBe(provisional.customerId);
  });

  it('is distinguishable from a customer a person onboarded (FR-014b)', async () => {
    const onboarded = await seedCustomerWith('email', 'known@example.com');
    const created = await identityService.resolveOrCreate(CHANNELS.EMAIL, 'stranger@example.com');

    const provisionals = await Customer.findAll({ where: { is_provisional: true } });

    expect(provisionals.map((row) => row.id)).toEqual([created.customerId]);
    expect((await Customer.findByPk(onboarded.id))?.is_provisional).toBe(false);
  });
});
