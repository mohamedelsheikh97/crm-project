import { TICKET_STATUSES, type TicketStatus } from '../tickets/lifecycle.js';

/**
 * WHEN THE SLA CLOCK RUNS, STOPS, AND FINISHES (Phase 6, FR-021, FR-023).
 *
 * A DECLARATION, NOT A SERVICE. It sits beside `tickets/lifecycle.ts` and
 * `auth/permissions.ts` rather than inside `services/` on the same reasoning
 * Phase 5 used for `channels/types.ts`: several layers read it and it holds no
 * decisions of its own.
 *
 * FR-023 FORBIDS A SECOND PARALLEL STATE MACHINE, and the failure that rule
 * prevents is concrete and cheap to hit: a later phase adds a seventh status,
 * declares its edges in `lifecycle.ts`, and the SLA clock silently treats it as
 * active because nobody remembered a second list existed. `assertExhaustive()`
 * below turns that into a red test rather than a wrong clock.
 *
 * The classification itself is Clarifications Q1's reading of Phase 3's
 * lifecycle: PENDING means waiting on someone outside the organisation, so the
 * time is not ours to be charged for. New, Open and Escalated are all active —
 * `escalated` in particular is NOT terminal, because a breached ticket's clock
 * must keep running for a re-armed target to be detectable.
 */

/** Waiting on someone outside the organisation. The clock stops (FR-021). */
export const PAUSED_STATUSES: readonly TicketStatus[] = ['pending'];

/** The work is done. The resolution target is satisfied, not breached. */
export const RESOLVED_STATUSES: readonly TicketStatus[] = ['resolved', 'closed'];

/** Everything else: the clock runs. */
export const ACTIVE_STATUSES: readonly TicketStatus[] = ['new', 'open', 'escalated'];

const PAUSED_SET: ReadonlySet<string> = new Set(PAUSED_STATUSES);
const RESOLVED_SET: ReadonlySet<string> = new Set(RESOLVED_STATUSES);
const ACTIVE_SET: ReadonlySet<string> = new Set(ACTIVE_STATUSES);

export function isPausedStatus(status: TicketStatus): boolean {
  return PAUSED_SET.has(status);
}

export function isResolvedStatus(status: TicketStatus): boolean {
  return RESOLVED_SET.has(status);
}

export function isActiveStatus(status: TicketStatus): boolean {
  return ACTIVE_SET.has(status);
}

/**
 * Every status classified exactly once. Called by the declaration test rather
 * than at runtime — a wrong classification is a build failure, not a 500.
 *
 * Returns the offending statuses so the test can name them instead of only
 * reporting that something is wrong.
 */
export function unclassifiedStatuses(): TicketStatus[] {
  return TICKET_STATUSES.filter(
    (status) =>
      Number(PAUSED_SET.has(status)) +
        Number(RESOLVED_SET.has(status)) +
        Number(ACTIVE_SET.has(status)) !==
      1,
  );
}
