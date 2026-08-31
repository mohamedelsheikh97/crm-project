import type { Transaction } from 'sequelize';

import { normaliseContact, type ContactKind } from '../lib/phone.js';
import { Customer, CustomerContact } from '../models/index.js';
import { CHANNELS, type Channel } from '../models/message.model.js';

/**
 * WHICH CUSTOMER DOES THIS SENDER BELONG TO?
 *
 * The single place that question is answered, for every channel (FR-011). It is
 * upstream of everything else in this phase, and the only place where being
 * wrong is worse than doing nothing: a misattributed message puts one
 * customer's words into another customer's record and timeline.
 *
 * THREE OUTCOMES, NEVER A NULLABLE ID. `ambiguous` and `unknown` are different
 * situations needing different handling — one needs a person to choose, the
 * other creates a provisional record. Collapsing them into "no customer" is
 * exactly how one silently becomes the other.
 *
 * MATCHING IS EXACT. No fuzzy matching, no domain matching (FR-016). Everyone
 * at `@acme.com` is not Acme — shared corporate domains, forwarding addresses
 * and personal accounts all break that assumption, and the cost of breaking it
 * is disclosing one customer's correspondence to another.
 *
 * Normalisation is `lib/phone.ts`, the single site Phase 2 established, and the
 * lookup is on `customer_contacts.value_normalised`, the index Phase 2's
 * duplicate check already built. This phase adds no second identity store.
 */

/** Email normalises differently from a phone number; using the wrong one means
 *  storing a value in one form and looking it up in another. */
export function contactKindFor(channel: Channel): ContactKind {
  return channel === CHANNELS.EMAIL ? 'email' : 'phone';
}

export type IdentityOutcome =
  | { kind: 'resolved'; customerId: number; isProvisional: boolean; isActive: boolean }
  /** More than one customer holds this contact. Nothing is chosen (FR-015). */
  | { kind: 'ambiguous'; customerIds: number[] }
  | { kind: 'unknown' };

/**
 * Resolve without creating anything.
 *
 * Separate from `resolveOrCreate` on purpose: the chat and form paths want to
 * know whether an identity is recognised before they decide what to do, and a
 * lookup that silently creates a customer as a side effect would be a trap.
 */
export async function resolve(channel: Channel, identity: string): Promise<IdentityOutcome> {
  const normalised = normaliseContact(contactKindFor(channel), identity);

  // An empty identity must never match another empty identity. The same rule
  // Phase 2's duplicate detector follows.
  if (normalised === '') return { kind: 'unknown' };

  const contacts = await CustomerContact.findAll({
    where: { value_normalised: normalised },
    include: [{ model: Customer, as: 'customer' }],
  });

  const byCustomer = new Map<number, Customer>();

  for (const contact of contacts) {
    const customer = (contact as CustomerContact & { customer?: Customer }).customer;
    if (customer) byCustomer.set(customer.id, customer);
  }

  if (byCustomer.size === 0) return { kind: 'unknown' };

  if (byCustomer.size > 1) {
    return { kind: 'ambiguous', customerIds: [...byCustomer.keys()].sort((a, b) => a - b) };
  }

  const customer = [...byCustomer.values()][0] as Customer;

  return {
    kind: 'resolved',
    customerId: customer.id,
    isProvisional: customer.is_provisional,
    // An inactive customer still resolves: the message is captured, and the
    // agent is shown the standing rather than the message being dropped
    // (FR-018).
    isActive: customer.is_active,
  };
}

/**
 * A display name for a customer nobody has named yet.
 *
 * The raw sender, not an invented placeholder. "Unknown sender 47" tells an
 * agent nothing; `hala@example.com` tells them who wrote and lets them search
 * for it. Provisional records exist to be recognised and merged, and that is
 * easier when they say what they are.
 */
function provisionalNameFor(identity: string): string {
  return identity.trim().slice(0, 255) || 'Unknown sender';
}

export interface ResolveResult {
  customerId: number;
  /** True when this call created the customer. Drives the ticket's notice. */
  created: boolean;
  isAmbiguous: boolean;
  ambiguousCustomerIds: number[];
}

/**
 * Resolve, and create a provisional customer when nothing matches
 * (Clarifications Q2, FR-014a).
 *
 * A MESSAGE IS NEVER LEFT WITHOUT A CUSTOMER. `tickets.customer_id` is NOT
 * NULL, and every Phase 3 and Phase 4 consumer — the queue, the context panel,
 * the timeline — assumes a ticket has one. Relaxing that would have meant
 * teaching all of them about a state that exists only at intake.
 *
 * On AMBIGUITY the message is attached to the earliest matching customer so it
 * is not lost, and the ambiguity is reported so the ticket can be flagged for a
 * person to resolve. That is not the system choosing: nothing is silently
 * merged, nothing is written to the wrong record permanently, and
 * `messages:reattribute` moves it in one action once someone decides.
 */
export async function resolveOrCreate(
  channel: Channel,
  identity: string,
  transaction?: Transaction,
): Promise<ResolveResult> {
  const outcome = await resolve(channel, identity);

  if (outcome.kind === 'resolved') {
    return {
      customerId: outcome.customerId,
      created: false,
      isAmbiguous: false,
      ambiguousCustomerIds: [],
    };
  }

  if (outcome.kind === 'ambiguous') {
    return {
      customerId: outcome.customerIds[0] as number,
      created: false,
      isAmbiguous: true,
      ambiguousCustomerIds: outcome.customerIds,
    };
  }

  const kind = contactKindFor(channel);
  const normalised = normaliseContact(kind, identity);

  const customer = await Customer.create(
    {
      display_name: provisionalNameFor(identity),
      company: null,
      address: null,
      is_active: true,
      is_provisional: true,
      // No creator: the system made this record, not a person. The same honesty
      // `tickets.created_by_user_id` applies (research D9).
      created_by_user_id: null,
    },
    { transaction },
  );

  // The contact row is what makes the NEXT message from this sender resolve
  // normally, rather than creating a second provisional customer each time.
  await CustomerContact.create(
    {
      customer_id: customer.id,
      kind,
      value_raw: identity.trim().slice(0, 255),
      value_normalised: normalised,
      is_primary: true,
    },
    { transaction },
  );

  return {
    customerId: customer.id,
    created: true,
    isAmbiguous: false,
    ambiguousCustomerIds: [],
  };
}
