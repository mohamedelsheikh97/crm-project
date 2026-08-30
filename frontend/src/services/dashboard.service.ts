import { http } from './http';

import type { Ticket, TicketPriority, TicketStatus } from './tickets.service';

/**
 * The agent's queue, and the customer context panel beside an open ticket.
 *
 * Every request goes through `http` (Principle III): no component in this phase
 * calls fetch directly.
 */

export interface QueueItem {
  id: number;
  reference: string;
  subject: string;
  customer: { id: number; displayName: string; isActive: boolean } | null;
  status: TicketStatus;
  priority: TicketPriority;
  dueAt: string | null;
  /**
   * Computed by the SERVER against the server clock (FR-020).
   *
   * Never recompute this from `dueAt` in the browser: two agents in different
   * timezones would then disagree about what is late, and the one whose clock
   * is wrong would be confidently wrong.
   */
  isOverdue: boolean;
  waitingSince: string;
}

export interface QueuePage {
  items: QueueItem[];
  page: number;
  pageSize: number;
  total: number;
  /** So the interface can say whose queue is on screen (FR-011). */
  viewingUser: { id: number; fullName: string };
}

export type QueueSort = 'priority' | 'status' | 'age' | 'dueAt';

export interface QueueQuery {
  userId?: number;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  overdue?: boolean;
  includeClosed?: boolean;
  sort?: QueueSort;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function toQuery(query: QueueQuery): string {
  const params = new URLSearchParams();

  if (query.userId !== undefined) params.set('userId', String(query.userId));
  for (const status of query.status ?? []) params.append('status', status);
  for (const priority of query.priority ?? []) params.append('priority', priority);
  if (query.overdue) params.set('overdue', 'true');
  if (query.includeClosed) params.set('includeClosed', 'true');
  if (query.sort) params.set('sort', query.sort);
  if (query.direction) params.set('direction', query.direction);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));

  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

export function fetchQueue(query: QueueQuery = {}): Promise<QueuePage> {
  return http.get<QueuePage>(`/dashboard/queue${toQuery(query)}`);
}

export interface CustomerContext {
  customer: {
    id: number;
    displayName: string;
    company: string | null;
    isActive: boolean;
    contacts: Array<{ id: number; kind: string; value: string; isPrimary: boolean }>;
  };
  otherTickets: Array<{
    id: number;
    reference: string;
    subject: string;
    status: TicketStatus;
    priority: TicketPriority;
  }>;
  recentNotes: Array<{
    id: number;
    body: string;
    author: { id: number; fullName: string } | null;
    createdAt: string;
  }>;
}

/**
 * One call for the whole panel. Three round-trips would make "without
 * navigating away" — the phase's Definition of done — feel like navigating
 * away.
 *
 * A caller without `customers:view` gets a 403 here; the panel is then omitted
 * and the ticket stays fully workable (FR-018), so this rejection must never be
 * surfaced as a page-level error.
 */
export function fetchCustomerContext(ticketId: number): Promise<CustomerContext> {
  return http.get<CustomerContext>(`/tickets/${ticketId}/context`);
}

/** `dueAt: null` clears the date (FR-026). A past date is accepted (FR-024). */
export function setDueDate(
  ticketId: number,
  dueAt: string | null,
  version: number,
): Promise<Ticket> {
  return http.put<Ticket>(`/tickets/${ticketId}/due-date`, { dueAt, version });
}
