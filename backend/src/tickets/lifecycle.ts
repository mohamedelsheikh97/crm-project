import type { PermissionKey } from '../auth/permissions.js';

/**
 * THE LIFECYCLE DECLARATION — the phase's central structure.
 *
 * The enforcement service, the endpoint that tells the interface which moves to
 * offer, and the generated 36-pair test all read THIS constant. Nothing holds a
 * second copy, which is why the test proves the service honours the declaration
 * rather than that someone transcribed a list correctly twice.
 *
 * Later phases inherit it: Phase 4 groups its dashboard by these statuses,
 * Phase 5 starts and stops its SLA clock on these transitions, Phase 8 counts
 * them. Changing this table changes those phases.
 *
 * THE DEFAULT IS REFUSAL. A pair absent from TRANSITIONS is not permitted, so
 * adding a seventh status without declaring its edges produces a ticket that
 * cannot move — visibly broken — rather than one that can move anywhere.
 */

export const TICKET_STATUSES = [
  'new',
  'open',
  'pending',
  'escalated',
  'resolved',
  'closed',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

const STATUS_SET: ReadonlySet<string> = new Set(TICKET_STATUSES);

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

/** A status is stored as its key and rendered from this (Principle I). */
export function statusNameKey(status: TicketStatus): string {
  return `ticket.status.${status}`;
}

export interface TransitionEdge {
  to: TicketStatus;
  permission: PermissionKey;
}

/**
 * 13 permitted edges of 36 ordered pairs.
 *
 * Two carry a permission different from the rest. `resolved -> closed` needs
 * tickets:close, which the service additionally conditions on ownership.
 * `closed -> open` needs tickets:reopen, which only a Supervisor holds —
 * closing finishes work, reopening undoes something already finished
 * (Clarifications Q2).
 */
export const TRANSITIONS: Readonly<Record<TicketStatus, readonly TransitionEdge[]>> = {
  // Nothing is resolved, escalated, or pended before someone opens it (FR-018).
  // This is the constraint a naive any-status-to-any-status implementation
  // violates first.
  new: [{ to: 'open', permission: 'tickets:transition' }],
  open: [
    { to: 'pending', permission: 'tickets:transition' },
    { to: 'escalated', permission: 'tickets:transition' },
    { to: 'resolved', permission: 'tickets:transition' },
  ],
  pending: [
    { to: 'open', permission: 'tickets:transition' },
    { to: 'escalated', permission: 'tickets:transition' },
    { to: 'resolved', permission: 'tickets:transition' },
  ],
  // Escalated is NOT a dead end (FR-030): it reaches Resolved directly, and it
  // can come back down (FR-031).
  escalated: [
    { to: 'open', permission: 'tickets:transition' },
    { to: 'pending', permission: 'tickets:transition' },
    { to: 'resolved', permission: 'tickets:transition' },
  ],
  resolved: [
    { to: 'open', permission: 'tickets:transition' },
    // Closed is reachable ONLY from Resolved (FR-019). There is no shortcut
    // from Open: finishing work and settling it are two acts.
    { to: 'closed', permission: 'tickets:close' },
  ],
  closed: [{ to: 'open', permission: 'tickets:reopen' }],
} as const;

/** The status a ticket starts in. Never accepted from a caller. */
export const INITIAL_STATUS: TicketStatus = 'new';

export function edgeFor(from: TicketStatus, to: TicketStatus): TransitionEdge | null {
  return TRANSITIONS[from].find((edge) => edge.to === to) ?? null;
}

export function isTransitionDeclared(from: TicketStatus, to: TicketStatus): boolean {
  return edgeFor(from, to) !== null;
}

/** Every declared move out of a status, ignoring who is asking. */
export function declaredTransitionsFrom(from: TicketStatus): readonly TransitionEdge[] {
  return TRANSITIONS[from];
}
