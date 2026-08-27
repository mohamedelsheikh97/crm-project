import { Op } from 'sequelize';

import { normaliseContact, type ContactKind } from '../lib/phone.js';
import { Customer, CustomerContact } from '../models/index.js';

/**
 * THE SINGLE DUPLICATE DETECTOR.
 *
 * Called by the create path AND the update path. FR-017 and FR-021 are the same
 * rule applied at two moments, and they must not be able to drift — a second
 * implementation for edits is exactly how one of them silently stops working.
 *
 * Three properties this must keep:
 *
 * - Deactivated customers ARE included (FR-019), or a retired customer is
 *   silently recreated as a second record.
 * - ALL matches are returned, not the first (FR-022).
 * - Matching is on the NORMALISED value, so formatting cannot defeat it
 *   (SC-002). Normalisation comes from lib/phone.ts and nowhere else.
 */

export interface ContactInput {
  kind: ContactKind;
  value: string;
}

export interface DuplicateMatch {
  matchedOn: ContactKind;
  matchedValue: string;
  customer: {
    id: number;
    displayName: string;
    company: string | null;
    isActive: boolean;
    primaryPhone: { raw: string; normalised: string } | null;
    primaryEmail: string | null;
  };
}

interface FindDuplicatesOptions {
  contacts: ContactInput[];
  /** The customer being edited, so it is never flagged against itself. */
  excludeCustomerId?: number | null;
}

export async function findDuplicates({
  contacts,
  excludeCustomerId = null,
}: FindDuplicatesOptions): Promise<DuplicateMatch[]> {
  const normalised = contacts
    .map((contact) => ({
      kind: contact.kind,
      normalised: normaliseContact(contact.kind, contact.value),
    }))
    // An empty value must never match another empty value as a "duplicate".
    .filter((contact) => contact.normalised !== '');

  if (normalised.length === 0) {
    return [];
  }

  const rows = await CustomerContact.findAll({
    where: {
      value_normalised: { [Op.in]: normalised.map((contact) => contact.normalised) },
      ...(excludeCustomerId === null ? {} : { customer_id: { [Op.ne]: excludeCustomerId } }),
    },
    include: [
      {
        model: Customer,
        as: 'customer',
        // No is_active filter: a deactivated customer must still be matched
        // (FR-019).
        include: [{ model: CustomerContact, as: 'contacts' }],
      },
    ],
  });

  const matches: DuplicateMatch[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    // Only count a row when the KIND matches too — an email that happens to
    // equal a normalised phone string is not the same contact.
    const requested = normalised.find(
      (contact) => contact.kind === row.kind && contact.normalised === row.value_normalised,
    );

    if (!requested) continue;

    const customer = (row as CustomerContact & { customer?: Customer }).customer;

    if (!customer) continue;

    // One entry per (customer, kind, value): two identical contacts on the same
    // record should not produce two warnings about the same thing.
    const key = `${customer.id}:${row.kind}:${row.value_normalised}`;
    if (seen.has(key)) continue;
    seen.add(key);

    matches.push({
      matchedOn: row.kind,
      matchedValue: row.value_normalised,
      customer: summarise(customer),
    });
  }

  return matches;
}

function summarise(customer: Customer): DuplicateMatch['customer'] {
  const contacts = (customer as Customer & { contacts?: CustomerContact[] }).contacts ?? [];
  const phone = pickPrimary(contacts, 'phone');
  const email = pickPrimary(contacts, 'email');

  return {
    id: customer.id,
    displayName: customer.display_name,
    company: customer.company,
    isActive: customer.is_active,
    // Raw is what a human is shown; normalised is included so the interface can
    // explain WHY this record matched.
    primaryPhone: phone ? { raw: phone.value_raw, normalised: phone.value_normalised } : null,
    primaryEmail: email ? email.value_raw : null,
  };
}

function pickPrimary(contacts: CustomerContact[], kind: ContactKind): CustomerContact | null {
  const ofKind = contacts.filter((contact) => contact.kind === kind);

  return ofKind.find((contact) => contact.is_primary) ?? ofKind[0] ?? null;
}
