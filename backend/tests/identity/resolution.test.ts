import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CHANNELS } from '../../src/models/message.model.js';
import { Customer, CustomerContact } from '../../src/models/index.js';
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

/**
 * US2 — the message finds the right customer.
 *
 * The only place in this phase where being wrong is worse than doing nothing: a
 * misattributed message puts one customer's words into another customer's
 * record and timeline (FR-011-FR-016, SC-004).
 */

async function seedCustomerWith(
  contacts: Array<{ kind: 'email' | 'phone'; value: string }>,
  options: { isActive?: boolean; name?: string } = {},
): Promise<Customer> {
  const { normaliseContact } = await import('../../src/lib/phone.js');

  const customer = await Customer.create({
    display_name: options.name ?? 'Test Customer',
    company: null,
    address: null,
    is_active: options.isActive ?? true,
    created_by_user_id: null,
  });

  for (const contact of contacts) {
    await CustomerContact.create({
      customer_id: customer.id,
      kind: contact.kind,
      value_raw: contact.value,
      value_normalised: normaliseContact(contact.kind, contact.value),
      is_primary: false,
    });
  }

  return customer;
}

describe('identity resolution (FR-011, FR-016)', () => {
  it('resolves an exact email match', async () => {
    const customer = await seedCustomerWith([{ kind: 'email', value: 'hala@example.com' }]);

    const outcome = await identityService.resolve(CHANNELS.EMAIL, 'hala@example.com');

    expect(outcome).toEqual({
      kind: 'resolved',
      customerId: customer.id,
      isProvisional: false,
      isActive: true,
    });
  });

  it('matches an email regardless of case', async () => {
    const customer = await seedCustomerWith([{ kind: 'email', value: 'Hala@Example.com' }]);

    const outcome = await identityService.resolve(CHANNELS.EMAIL, 'HALA@EXAMPLE.COM');

    expect(outcome).toMatchObject({ kind: 'resolved', customerId: customer.id });
  });

  it('resolves the same phone number written three different ways', async () => {
    // The payoff for normalising through lib/phone.ts rather than comparing
    // strings: a customer who gives their number one way and messages from
    // another is still the same person (FR-012).
    const customer = await seedCustomerWith([{ kind: 'phone', value: '+20 100 123 4567' }]);

    for (const written of ['+201001234567', '00201001234567', '01001234567']) {
      const outcome = await identityService.resolve(CHANNELS.SMS, written);

      expect(outcome, `failed for ${written}`).toMatchObject({
        kind: 'resolved',
        customerId: customer.id,
      });
    }
  });

  it('resolves an inactive customer and reports the standing (FR-018)', async () => {
    // The message is still captured. Dropping correspondence because a record
    // was deactivated would lose a real customer's real question.
    const customer = await seedCustomerWith([{ kind: 'email', value: 'gone@example.com' }], {
      isActive: false,
    });

    const outcome = await identityService.resolve(CHANNELS.EMAIL, 'gone@example.com');

    expect(outcome).toEqual({
      kind: 'resolved',
      customerId: customer.id,
      isProvisional: false,
      isActive: false,
    });
  });

  it('NEVER matches on a shared domain (FR-016)', async () => {
    // Everyone at @acme.com is not Acme. Shared corporate domains, forwarding
    // addresses and personal accounts all break that assumption, and the cost
    // of breaking it is disclosing one customer's correspondence to another.
    await seedCustomerWith([{ kind: 'email', value: 'ceo@acme.com' }]);

    const outcome = await identityService.resolve(CHANNELS.EMAIL, 'someone.else@acme.com');

    expect(outcome).toEqual({ kind: 'unknown' });
  });

  it('never matches on a partial phone number', async () => {
    await seedCustomerWith([{ kind: 'phone', value: '+201001234567' }]);

    const outcome = await identityService.resolve(CHANNELS.SMS, '1234567');

    expect(outcome).toEqual({ kind: 'unknown' });
  });

  it('treats an empty identity as unknown, never as a match', async () => {
    // An empty value must not match another empty value — the rule Phase 2's
    // duplicate detector already follows.
    await seedCustomerWith([{ kind: 'email', value: 'someone@example.com' }]);

    expect(await identityService.resolve(CHANNELS.EMAIL, '')).toEqual({ kind: 'unknown' });
    expect(await identityService.resolve(CHANNELS.EMAIL, '   ')).toEqual({ kind: 'unknown' });
  });

  it('uses email normalisation for email and phone normalisation for the rest', async () => {
    // Using the wrong one would store a value in one form and look it up in
    // another — a defeat by formatting, which is what lib/phone.ts exists to
    // prevent.
    expect(identityService.contactKindFor(CHANNELS.EMAIL)).toBe('email');
    expect(identityService.contactKindFor(CHANNELS.SMS)).toBe('phone');
    expect(identityService.contactKindFor(CHANNELS.WHATSAPP)).toBe('phone');
  });
});
