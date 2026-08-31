import { clearSimulator } from '../../src/channels/simulator-store.js';
import { normaliseContact } from '../../src/lib/phone.js';
import { Customer, CustomerContact, Message, Ticket, User } from '../../src/models/index.js';
import type { Channel } from '../../src/models/message.model.js';

/**
 * A ticket with a conversation on it, so a reply has somewhere to go.
 *
 * Built through the models rather than through intake, for the reason Phase 2
 * and Phase 3 give for their own seed helpers: a send test should not fail
 * because intake has a bug.
 */
export async function seedConversation(
  options: {
    channel?: Channel;
    identity?: string;
    createdBy?: User;
    status?: 'new' | 'open' | 'closed';
  } = {},
): Promise<{ ticket: Ticket; customer: Customer; identity: string }> {
  const channel = options.channel ?? 'email';
  const identity = options.identity ?? (channel === 'email' ? 'hala@example.com' : '+201001234567');
  const kind = channel === 'email' ? 'email' : 'phone';

  const customer = await Customer.create({
    display_name: 'Hala Ahmed',
    company: null,
    address: null,
    is_active: true,
    created_by_user_id: null,
  });

  await CustomerContact.create({
    customer_id: customer.id,
    kind,
    value_raw: identity,
    value_normalised: normaliseContact(kind, identity),
    is_primary: true,
  });

  const ticket = await Ticket.create({
    customer_id: customer.id,
    subject: 'Card reader keeps rebooting',
    description: null,
    category: 'general',
    priority: 'normal',
    status: options.status ?? 'open',
    assignee_user_id: null,
    created_by_user_id: options.createdBy?.id ?? null,
    source: channel,
  });

  await Message.create({
    ticket_id: ticket.id,
    channel,
    direction: 'inbound',
    author_user_id: null,
    sender_identity: identity,
    sender_identity_normalised: normaliseContact(kind, identity),
    body: 'It reboots every morning.',
    body_format: 'text',
    delivery_state: 'delivered',
    occurred_at: new Date(),
  });

  return { ticket, customer, identity };
}

export function resetSimulator(): void {
  clearSimulator();
}
