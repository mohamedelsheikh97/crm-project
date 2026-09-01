import bcrypt from 'bcrypt';
import supertest from 'supertest';

import app from '../../src/app.js';
import {
  Customer,
  CustomerContact,
  Message,
  PortalAccount,
  Ticket,
} from '../../src/models/index.js';
import { toReference } from '../../src/tickets/reference.js';

/**
 * THE SHAPE EVERY PORTAL SECURITY TEST NEEDS (Phase 8, research.md D5).
 *
 * One customer with TWO contacts, one other customer, and four tickets:
 *
 *   - one belonging to contact A
 *   - one belonging to contact B — A's COLLEAGUE on the same customer record
 *   - one with NO requesting contact at all
 *   - one on a different customer entirely
 *
 * Those four are not arbitrary. They are the four things a portal read must
 * distinguish, and the middle two are the ones a naive implementation gets
 * wrong: record-wide scoping shows A their colleague's ticket, and treating a
 * NULL association as "visible to everyone on the record" shows A the third one.
 * Clarifications Q2 exists to prevent the first; FR-026f the second.
 *
 * Shared by the scope, projection, reply, and satisfaction suites so all four
 * reason about the same world — and so a change to what "a colleague" means has
 * one place to be made.
 */

export const PORTAL_PASSWORD = 'PortalPassw0rd!2026';

let sequence = 0;

function uniqueEmail(label: string): string {
  sequence += 1;
  return `${label}${sequence}@portal.test.local`;
}

export interface PortalContactFixture {
  contactId: number;
  accountId: number;
  email: string;
  accessToken: string;
}

export interface PortalWorld {
  customerId: number;
  otherCustomerId: number;
  /** The contact under test. */
  a: PortalContactFixture;
  /** Their colleague on the SAME customer record. */
  b: PortalContactFixture;
  /** A ticket associated with A. */
  ticketA: { id: number; reference: string };
  /** A ticket associated with B — the colleague test (SC-028). */
  ticketB: { id: number; reference: string };
  /** A ticket with `requesting_contact_id IS NULL` (SC-029). */
  ticketUnassociated: { id: number; reference: string };
  /** A ticket on a different customer (SC-003). */
  ticketOtherCustomer: { id: number; reference: string };
}

async function makeContactWithAccount(
  customerId: number,
  label: string,
): Promise<PortalContactFixture> {
  const email = uniqueEmail(label);

  const contact = await CustomerContact.create({
    customer_id: customerId,
    kind: 'email',
    value_raw: email,
    value_normalised: email.toLowerCase(),
    is_primary: false,
  });

  const account = await PortalAccount.create({
    customer_contact_id: contact.id,
    password_hash: await bcrypt.hash(PORTAL_PASSWORD, 12),
    status: 'active',
    failed_login_attempts: 0,
    locked_until: null,
    session_epoch: 0,
    invited_by_user_id: null,
    activated_at: new Date(),
    last_login_at: null,
    preferred_language: 'en',
  });

  // SIGNED IN THROUGH THE REAL ENDPOINT, so every test exercises the same path a
  // customer does — including the middleware, the realm check, and the freshness
  // read. A hand-minted token would test the tests.
  const response = await supertest(app)
    .post('/api/portal/auth/login')
    .send({ email, password: PORTAL_PASSWORD });

  if (response.status !== 200) {
    throw new Error(`Portal sign-in failed for ${email}: ${response.status} ${response.text}`);
  }

  return {
    contactId: contact.id,
    accountId: account.id,
    email,
    accessToken: response.body.accessToken as string,
  };
}

async function makeTicket(
  customerId: number,
  contactId: number | null,
  subject: string,
): Promise<{ id: number; reference: string }> {
  const ticket = await Ticket.create({
    customer_id: customerId,
    subject,
    description: `${subject} — description.`,
    category: 'general',
    priority: 'normal',
    status: 'open',
    assignee_user_id: null,
    created_by_user_id: null,
    source: 'portal',
    requesting_contact_id: contactId,
  });

  return { id: ticket.id, reference: toReference(ticket.id) };
}

export async function buildPortalWorld(): Promise<PortalWorld> {
  const customer = await Customer.create({
    display_name: 'Acme Industrial',
    // A COMPANY, deliberately. Clarifications Q2's whole argument is that one
    // customer record routinely represents an organisation whose contacts are
    // different people with different business from each other.
    company: 'Acme Industrial LLC',
    address: null,
    is_active: true,
    is_provisional: false,
    created_by_user_id: null,
  });

  const other = await Customer.create({
    display_name: 'Beta Trading',
    company: null,
    address: null,
    is_active: true,
    is_provisional: false,
    created_by_user_id: null,
  });

  const a = await makeContactWithAccount(customer.id, 'colleague-a');
  const b = await makeContactWithAccount(customer.id, 'colleague-b');

  const ticketA = await makeTicket(customer.id, a.contactId, 'A card reader is offline');
  const ticketB = await makeTicket(customer.id, b.contactId, 'My payroll query');
  const ticketUnassociated = await makeTicket(customer.id, null, 'Raised on a phone call');
  const ticketOtherCustomer = await makeTicket(other.id, null, 'Another company entirely');

  return {
    customerId: customer.id,
    otherCustomerId: other.id,
    a,
    b,
    ticketA,
    ticketB,
    ticketUnassociated,
    ticketOtherCustomer,
  };
}

/** supertest with a portal token pre-set. */
export function portalAgent(token: string) {
  const auth = (test: supertest.Test) => test.set('Authorization', `Bearer ${token}`);

  return {
    get: (url: string) => auth(supertest(app).get(url)),
    post: (url: string) => auth(supertest(app).post(url)),
    patch: (url: string) => auth(supertest(app).patch(url)),
    delete: (url: string) => auth(supertest(app).delete(url)),
  };
}

/** Adds correspondence to a ticket, so the projection has something to show. */
export async function addMessages(ticketId: number): Promise<void> {
  await Message.create({
    ticket_id: ticketId,
    channel: 'email',
    direction: 'inbound',
    author_user_id: null,
    sender_identity: 'customer@portal.test.local',
    sender_identity_normalised: 'customer@portal.test.local',
    body: 'The reader shows a red light.',
    body_format: 'text',
    provider_message_id: `fixture-in-${ticketId}`,
    outbound_message_id: null,
    delivery_state: 'delivered',
    delivery_detail: null,
    occurred_at: new Date(Date.now() - 60_000),
  });

  await Message.create({
    ticket_id: ticketId,
    channel: 'portal',
    direction: 'outbound',
    author_user_id: null,
    sender_identity: null,
    sender_identity_normalised: null,
    body: 'Have you tried the other socket?',
    body_format: 'text',
    provider_message_id: `fixture-out-${ticketId}`,
    outbound_message_id: null,
    delivery_state: 'sent',
    delivery_detail: null,
    occurred_at: new Date(),
  });
}
