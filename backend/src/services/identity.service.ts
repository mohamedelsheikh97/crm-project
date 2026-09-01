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

/**
 * Email normalises differently from a phone number; using the wrong one means
 * storing a value in one form and looking it up in another.
 *
 * The PORTAL is an email channel here (Phase 8): a portal account is keyed to an
 * email contact, so a portal reply's sender identity is an address and must
 * normalise as one. Falling through to 'phone' would store the address in phone
 * form and then fail to find it.
 *
 * A FORM IS NEITHER, AND THAT WAS A BUG (Phase 8, found while implementing
 * FR-026d).
 *
 * `form.service.validateSubmission` picks the submission's identity from the
 * first field typed `email` OR `phone` — so a form's sender identity is
 * genuinely one or the other, decided by whoever built the form. The channel
 * cannot say which. Before this, every form fell through to 'phone', so an email
 * address was normalised as a phone number: it matched no existing contact, and
 * each submission created ANOTHER provisional customer for a person the system
 * already knew.
 *
 * That is why the identity is a parameter. Where a caller has the value, its
 * shape decides; where it does not, the channel's default stands and nothing changes.
 * The check is deliberately crude: an at-sign with something either side, because
 * this is choosing a NORMALISER, not validating an address, and
 * `lib/phone.ts` remains the single normalisation site either way.
 */
export function contactKindFor(channel: Channel, identity?: string): ContactKind {
  if (channel === CHANNELS.EMAIL || channel === CHANNELS.PORTAL) return 'email';

  if (channel === CHANNELS.FORM && typeof identity === 'string') {
    return /^[^\s@]+@[^\s@]+$/.test(identity.trim()) ? 'email' : 'phone';
  }

  return 'phone';
}

export type IdentityOutcome =
  | {
      kind: 'resolved';
      customerId: number;
      /**
       * WHICH CONTACT ROW MATCHED (Phase 8, FR-026c).
       *
       * Already known here — the lookup is BY contact — and previously thrown
       * away because nothing needed it. Phase 8 needs it: a ticket created from
       * an inbound message records the contact that raised it, and that is what
       * makes the request visible in that person's portal and nobody else's.
       */
      contactId: number;
      isProvisional: boolean;
      isActive: boolean;
    }
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
  const normalised = normaliseContact(contactKindFor(channel, identity), identity);

  // An empty identity must never match another empty identity. The same rule
  // Phase 2's duplicate detector follows.
  if (normalised === '') return { kind: 'unknown' };

  const contacts = await CustomerContact.findAll({
    where: { value_normalised: normalised },
    include: [{ model: Customer, as: 'customer' }],
    // A TOTAL ordering, so the contact reported for a customer holding the same
    // address on two rows is the same one on every call (Phase 8, FR-026c).
    order: [['id', 'ASC']],
  });

  const byCustomer = new Map<number, Customer>();
  const contactByCustomer = new Map<number, number>();

  for (const contact of contacts) {
    const customer = (contact as CustomerContact & { customer?: Customer }).customer;
    if (!customer) continue;
    byCustomer.set(customer.id, customer);
    if (!contactByCustomer.has(customer.id)) contactByCustomer.set(customer.id, contact.id);
  }

  if (byCustomer.size === 0) return { kind: 'unknown' };

  if (byCustomer.size > 1) {
    return { kind: 'ambiguous', customerIds: [...byCustomer.keys()].sort((a, b) => a - b) };
  }

  const customer = [...byCustomer.values()][0] as Customer;

  return {
    kind: 'resolved',
    customerId: customer.id,
    contactId: contactByCustomer.get(customer.id) as number,
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
  /**
   * The contact that matched, or was created (Phase 8, FR-026c).
   *
   * NULL ON AMBIGUITY, deliberately. Two customers hold this address; attaching
   * the ticket to one of their contacts would make it visible in that person's
   * portal on the strength of a coin toss. `messages:reattribute` moves the
   * ticket once somebody decides, and `setRequestingContact` records whose it
   * was — both human acts, which is what an ambiguous identity deserves.
   */
  contactId: number | null;
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
      contactId: outcome.contactId,
      created: false,
      isAmbiguous: false,
      ambiguousCustomerIds: [],
    };
  }

  if (outcome.kind === 'ambiguous') {
    return {
      customerId: outcome.customerIds[0] as number,
      // See ResolveResult.contactId: nothing is chosen on ambiguity.
      contactId: null,
      created: false,
      isAmbiguous: true,
      ambiguousCustomerIds: outcome.customerIds,
    };
  }

  const kind = contactKindFor(channel, identity);
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
  const contact = await CustomerContact.create(
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
    contactId: contact.id,
    created: true,
    isAmbiguous: false,
    ambiguousCustomerIds: [],
  };
}
