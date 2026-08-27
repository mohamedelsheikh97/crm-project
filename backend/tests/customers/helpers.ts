import { Customer, CustomerContact } from '../../src/models/index.js';
import { normaliseContact, type ContactKind } from '../../src/lib/phone.js';

export interface SeedContact {
  kind: ContactKind;
  value: string;
  isPrimary?: boolean;
}

let sequence = 0;

/**
 * Creates a customer directly through the models, bypassing the service.
 *
 * Deliberate: a test for search or duplicate detection should not depend on
 * the create endpoint working, or a single bug fails half the suite for the
 * wrong reason.
 */
export async function seedCustomer(
  options: {
    displayName?: string;
    company?: string | null;
    contacts?: SeedContact[];
    isActive?: boolean;
  } = {},
): Promise<Customer> {
  const {
    displayName = `Customer ${(sequence += 1)}`,
    company = null,
    contacts = [{ kind: 'phone' as const, value: `010012345${String(sequence).padStart(2, '0')}` }],
    isActive = true,
  } = options;

  const customer = await Customer.create({
    display_name: displayName,
    company,
    address: null,
    is_active: isActive,
    created_by_user_id: null,
  });

  await CustomerContact.bulkCreate(
    contacts.map((contact, index) => ({
      customer_id: customer.id,
      kind: contact.kind,
      value_raw: contact.value,
      value_normalised: normaliseContact(contact.kind, contact.value),
      is_primary: contact.isPrimary ?? index === 0,
    })),
  );

  return customer;
}

/** A valid create payload, so a test only states what it is actually varying. */
export function customerPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: 'Ahmed Hassan',
    company: null,
    address: null,
    contacts: [{ kind: 'phone', value: '01001234567', isPrimary: true }],
    ...overrides,
  };
}
