import type { SlaView } from './sla.service';

import { ApiError, http } from './http';

import type { Paged } from './admin-users.service';

export type TicketStatus = 'new' | 'open' | 'pending' | 'escalated' | 'resolved' | 'closed';
export type TicketCategory = 'general' | 'technical' | 'billing' | 'complaint';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Mirrors backend/src/tickets/lifecycle.ts and taxonomy.ts for TYPING ONLY.
 *
 * These are not the lifecycle table. The available moves come from
 * GET /tickets/:id/transitions on every render, so this file holds no copy of
 * the edges — a front-end copy would drift, and the direction it drifts is
 * offering a button that then fails.
 */
export const TICKET_STATUSES: TicketStatus[] = [
  'new',
  'open',
  'pending',
  'escalated',
  'resolved',
  'closed',
];

export const TICKET_CATEGORIES: TicketCategory[] = ['general', 'technical', 'billing', 'complaint'];

/** Ordered by urgency, because that is the order a human reads them in. */
export const TICKET_PRIORITIES: TicketPriority[] = ['urgent', 'high', 'normal', 'low'];

export interface TicketSummary {
  id: number;
  reference: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  customer: { id: number; displayName: string; isActive: boolean } | null;
  assignee: { id: number; fullName: string; isActive: boolean } | null;
  mergedIntoTicketId: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketLinkView {
  id: number;
  ticket: { id: number; reference: string; subject: string; status: TicketStatus };
}

export interface Ticket extends TicketSummary {
  description: string | null;
  /**
   * Phase 4. Set manually by a permitted user; null means none.
   *
   * Whether the ticket is OVERDUE is not derived from this in the browser —
   * that comes from the server, so two agents in different timezones cannot
   * disagree about what is late (FR-020).
   */
  dueAt?: string | null;
  /**
   * Present ONLY on the response to a close that left open follow-ups behind
   * (FR-064). Its absence means there were none — it is a notice, never a
   * refusal, and the close has already happened either way.
   */
  outstandingTasks?: Array<{ id: number; title: string; dueAt: string | null }>;
  /**
   * Phase 6 (FR-020). NULL when the ticket matched no SLA policy (FR-014) —
   * not an object of nulls, so nothing can render a countdown for a commitment
   * nobody made.
   *
   * `state` is computed SERVER-SIDE against the one authoritative clock
   * (FR-011). Never derive it here from `targetAt` and the browser's clock:
   * that is how "overdue" comes to mean two different things for a viewer in
   * Cairo and one in London, which SC-002 forbids.
   */
  sla: SlaView | null;
  escalationReason: string | null;
  createdBy: { id: number; fullName: string } | null;
  links: TicketLinkView[];
  survivor: { id: number; reference: string } | null;
  /**
   * Phase 8 (FR-026i). WHICH CONTACT CAN SEE THIS IN THE PORTAL.
   *
   * NULL means nobody can — which is the state most tickets raised before this
   * phase are in, and the answer to "the customer says they cannot find their
   * ticket".
   */
  requestingContact: { id: number; email: string } | null;
  /**
   * Phase 8 (FR-053). The customer's rating of the resolution.
   *
   * NULL covers both "not asked yet" and "asked and ignored", and deliberately
   * does not distinguish them: nothing records that we asked, because FR-051
   * requires ignoring the invitation to create nothing at all.
   */
  satisfaction: { score: number; comment: string | null; submittedAt: string } | null;
}

export interface HistoryEntry {
  id: number;
  event: string;
  actorName: string;
  field: string | null;
  previousValue: string | null;
  newValue: string | null;
  note: string | null;
  createdAt: string;
  /** Which ticket it happened to, so a spanning history stays readable. */
  ticketId: number;
}

export interface TicketFilters {
  q?: string;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  category?: TicketCategory[];
  assigneeId?: number | 'unassigned';
  customerId?: number;
  sort?: string;
  includeMerged?: boolean;
  page?: number;
  pageSize?: number;
}

export interface TicketInput {
  customerId?: number;
  subject: string;
  description?: string | null;
  category: TicketCategory;
  priority: TicketPriority;
  version?: number;
}

function query(filters: TicketFilters): string {
  const params = new URLSearchParams();

  if (filters.q) params.set('q', filters.q);
  // Repeatable, so a filter for two statuses is two parameters rather than a
  // comma-separated string the server would have to re-parse.
  for (const status of filters.status ?? []) params.append('status', status);
  for (const priority of filters.priority ?? []) params.append('priority', priority);
  for (const category of filters.category ?? []) params.append('category', category);
  if (filters.assigneeId !== undefined) params.set('assigneeId', String(filters.assigneeId));
  if (filters.customerId !== undefined) params.set('customerId', String(filters.customerId));
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.includeMerged) params.set('includeMerged', 'true');
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/**
 * Reads the reachable set out of a 422 TRANSITION_NOT_ALLOWED.
 *
 * It arrives as a SIBLING of the error envelope rather than inside `details[]`,
 * the same shape Phase 2 used for `duplicates`.
 */
export function refusedTransitionFrom(
  cause: unknown,
): { from: TicketStatus; to: string; allowed: TicketStatus[] } | null {
  if (cause instanceof ApiError && cause.code === 'TRANSITION_NOT_ALLOWED') {
    return (
      (cause.payload.transition as { from: TicketStatus; to: string; allowed: TicketStatus[] }) ??
      null
    );
  }

  return null;
}

/** Where a merged ticket redirects to, read off a 422 TICKET_MERGED. */
export function survivorFrom(
  cause: unknown,
): { survivorId: number; survivorReference: string } | null {
  if (cause instanceof ApiError && cause.code === 'TICKET_MERGED') {
    return (cause.payload.merged as { survivorId: number; survivorReference: string }) ?? null;
  }

  return null;
}

export async function list(filters: TicketFilters = {}): Promise<Paged<TicketSummary>> {
  return http.get<Paged<TicketSummary>>(`/tickets${query(filters)}`);
}

export async function get(id: number): Promise<Ticket> {
  return http.get<Ticket>(`/tickets/${id}`);
}

export async function create(input: TicketInput): Promise<Ticket> {
  return http.post<Ticket>('/tickets', input);
}

export async function update(id: number, input: Partial<TicketInput>): Promise<Ticket> {
  return http.patch<Ticket>(`/tickets/${id}`, input);
}

/**
 * The moves available to THIS user on THIS ticket.
 *
 * The interface renders its buttons from this and never from a local list, so
 * it cannot offer a move the server would refuse.
 */
export async function transitions(
  id: number,
): Promise<{ status: TicketStatus; transitions: TicketStatus[] }> {
  return http.get(`/tickets/${id}/transitions`);
}

export async function transition(
  id: number,
  input: { to: TicketStatus; version: number; reason?: string; note?: string },
): Promise<Ticket> {
  return http.post<Ticket>(`/tickets/${id}/transitions`, input);
}

export async function assign(
  id: number,
  input: { userId: number | null; version: number },
): Promise<Ticket> {
  return http.put<Ticket>(`/tickets/${id}/assignee`, input);
}

export async function history(
  id: number,
  options: { page?: number; pageSize?: number } = {},
): Promise<Paged<HistoryEntry>> {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));

  const serialised = params.toString();
  return http.get<Paged<HistoryEntry>>(
    `/tickets/${id}/history${serialised ? `?${serialised}` : ''}`,
  );
}

export async function merge(
  id: number,
  input: { intoTicketId: number; version: number; note?: string },
): Promise<Ticket> {
  return http.post<Ticket>(`/tickets/${id}/merge`, input);
}

export async function link(id: number, linkedTicketId: number): Promise<Ticket> {
  return http.post<Ticket>(`/tickets/${id}/links`, { linkedTicketId });
}

export async function unlink(id: number, linkedTicketId: number): Promise<Ticket> {
  return http.delete<Ticket>(`/tickets/${id}/links/${linkedTicketId}`);
}
