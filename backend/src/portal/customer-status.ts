import { TICKET_STATUSES, type TicketStatus } from '../tickets/lifecycle.js';

/**
 * WHAT THE CUSTOMER IS TOLD (Phase 8, FR-028, research.md D7).
 *
 * Phase 3's six statuses are the only lifecycle this system has, and this file
 * does not add a second one. It is a presentation mapping: a total function from
 * an internal status to a state a customer can act on, plus what the portal may
 * offer them in it.
 *
 * It lives beside `tickets/lifecycle.ts` rather than inside a service for the
 * reason that file's own placement records: it is a declaration several layers
 * read, holding no business decisions of its own. The projection reads it, the
 * i18n keys derive from it, and nothing else in the portal touches
 * `ticket.status`.
 *
 * THE MAPPING IS NOT INJECTIVE, ON PURPOSE. `open` and `escalated` collapse into
 * one customer state because the difference between them is the organisation's
 * internal posture (FR-028). A customer who can tell they have been escalated
 * will ask "escalated to whom?", and the honest answer is not theirs to have.
 *
 * NO RUNTIME FALLBACK. `Record<TicketStatus, …>` means adding a seventh status
 * to the lifecycle without extending this table is a TYPE ERROR — the same
 * property `TRANSITIONS` gives, where an undeclared pair is refused rather than
 * defaulted. A `?? 'in_progress'` here would make a new status silently
 * mis-describe itself to every customer.
 */

export const CUSTOMER_STATES = [
  'received',
  'in_progress',
  'awaiting_you',
  'resolved',
  'closed',
] as const;

export type CustomerState = (typeof CUSTOMER_STATES)[number];

export interface CustomerStateView {
  state: CustomerState;
  /** Whether the portal invites a satisfaction rating here (FR-047). */
  ratingOffered: boolean;
  /**
   * Whether the portal offers a reply box here.
   *
   * FALSE ONLY FOR `closed`, and that boundary is Phase 3's rather than this
   * phase's (research D9). `TRANSITIONS` makes `closed -> open` need
   * `tickets:reopen`, held only by a Supervisor, "because closing finishes work
   * and reopening undoes something already finished". A customer reply that
   * reopened a closed ticket would route around that decision. On `resolved`
   * the reply is offered and reopens the ticket, because resolved is a state a
   * conversation can still come back from.
   */
  replyOffered: boolean;
}

const STATES: Readonly<Record<TicketStatus, CustomerStateView>> = {
  // Truthful: it has arrived and nobody has picked it up yet. Calling this
  // "open" would overstate what has happened.
  new: { state: 'received', ratingOffered: false, replyOffered: true },
  open: { state: 'in_progress', ratingOffered: false, replyOffered: true },
  // See the header: escalation is internal posture, not a customer state.
  escalated: { state: 'in_progress', ratingOffered: false, replyOffered: true },
  /**
   * THE ONE JUDGEMENT IN THIS TABLE, and research open question 1.
   *
   * `pending` is mapped to "waiting for you" on the strength of its position in
   * `TRANSITIONS` — it is the state `open` moves to and returns from, and the
   * codebase treats it as a hold. Phase 3 never says in words WHOSE hold it is.
   * If the organisation uses it for "waiting on a supplier", this line tells a
   * customer to act when they cannot, and the fix is this one word.
   */
  pending: { state: 'awaiting_you', ratingOffered: false, replyOffered: true },
  resolved: { state: 'resolved', ratingOffered: true, replyOffered: true },
  closed: { state: 'closed', ratingOffered: true, replyOffered: false },
};

export function customerStateFor(status: TicketStatus): CustomerStateView {
  return STATES[status];
}

/** An i18n key, never a literal label (Constitution Principle I). */
export function customerStateNameKey(state: CustomerState): string {
  return `portal.state.${state}`;
}

/**
 * Settled means "the work is finished", which is what the rating and the reply
 * affordances both hang off. Derived from the same table rather than from a
 * second list of statuses.
 */
export function isSettled(status: TicketStatus): boolean {
  return STATES[status].ratingOffered;
}

/** Exported so a test can prove the mapping covers the lifecycle exactly. */
export const MAPPED_STATUSES: readonly TicketStatus[] = TICKET_STATUSES;
