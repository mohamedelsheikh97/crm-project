import { Customer, Ticket, User } from '../../src/models/index.js';
import type { TicketStatus } from '../../src/tickets/lifecycle.js';
import type { TicketCategory, TicketPriority } from '../../src/tickets/taxonomy.js';
import { seedCustomer } from '../customers/helpers.js';

let sequence = 0;

/**
 * Creates a ticket directly through the model, bypassing the service.
 *
 * Deliberate, and the same reasoning Phase 2 used for customers: a lifecycle or
 * merge test should not depend on the create endpoint working, or one bug fails
 * half the suite for the wrong reason.
 *
 * It also lets a test put a ticket straight into `closed` — a state the service
 * would rightly refuse to create — which is the only way to test the edges
 * leading out of it without walking the whole lifecycle first.
 */
export async function seedTicket(
  options: {
    customer?: Customer;
    createdBy?: User;
    assignee?: User | null;
    status?: TicketStatus;
    category?: TicketCategory;
    priority?: TicketPriority;
    subject?: string;
    description?: string | null;
    mergedInto?: Ticket | null;
    escalationReason?: string | null;
  } = {},
): Promise<Ticket> {
  const customer = options.customer ?? (await seedCustomer());

  if (!options.createdBy) {
    throw new Error('seedTicket needs a createdBy user; tickets always have an author (FR-005).');
  }

  return Ticket.create({
    customer_id: customer.id,
    subject: options.subject ?? `Ticket ${(sequence += 1)}`,
    description: options.description ?? null,
    category: options.category ?? 'general',
    priority: options.priority ?? 'normal',
    status: options.status ?? 'new',
    assignee_user_id: options.assignee?.id ?? null,
    created_by_user_id: options.createdBy.id,
    merged_into_ticket_id: options.mergedInto?.id ?? null,
    escalation_reason: options.escalationReason ?? null,
  });
}

/** A valid create payload, so a test states only what it is actually varying. */
export function ticketPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: 'Cannot sign in',
    description: 'The password reset email never arrives.',
    category: 'technical',
    priority: 'high',
    ...overrides,
  };
}
