import type { PermissionKey } from '../auth/permissions.js';
import { forbidden, ticketMerged, transitionNotAllowed } from '../errors/app-error.js';
import { Ticket } from '../models/index.js';
import { TRANSITIONS, edgeFor, isTicketStatus, type TicketStatus } from '../tickets/lifecycle.js';
import { toReference } from '../tickets/reference.js';

import * as authorizationService from './authorization.service.js';

/**
 * THE ONLY PLACE A STATUS CHANGE IS AUTHORISED.
 *
 * Every path that writes a status calls assertTransitionAllowed: the transition
 * endpoint, and nothing else — because there IS nothing else. `update` refuses
 * `status` as an editable field precisely so this cannot be bypassed (FR-017).
 *
 * It reads backend/src/tickets/lifecycle.ts, the same constant the generated
 * 36-pair test reads. Neither holds a second copy, so the test proves the
 * service honours the declaration rather than that a list was transcribed
 * correctly twice.
 */

/**
 * `id: null` means THE SYSTEM (Phase 6, research.md D8). See the `Actor`
 * comment in ticket.service.ts for why the type widened rather than automation
 * growing its own write path.
 */
export interface LifecycleActor {
  id: number | null;
  email: string | null;
  roleId: number | null;
}

/**
 * A merged ticket is a redirect and is unworkable by EVERY route (FR-043).
 *
 * Checked first, before anything about the requested action, because it holds
 * regardless of what was asked for. It lives in the service rather than in each
 * endpoint so a route added later inherits it without remembering to.
 */
export async function assertWorkable(ticket: Ticket): Promise<void> {
  if (ticket.merged_into_ticket_id !== null) {
    const survivorId = await resolveSurvivorId(ticket);
    throw ticketMerged(survivorId, toReference(survivorId));
  }
}

/**
 * Follows a merge chain to the one ticket that survives (FR-045).
 *
 * Guards against a cycle rather than trusting one cannot exist: merge refuses
 * to create one, but a request that hung forever would be a far worse failure
 * than a refusal, and the guard costs a Set.
 */
export async function resolveSurvivorId(ticket: Ticket): Promise<number> {
  const seen = new Set<number>([ticket.id]);
  let current = ticket;

  while (current.merged_into_ticket_id !== null) {
    const nextId = current.merged_into_ticket_id;

    if (seen.has(nextId)) {
      // A cycle reached the database despite the create-time guard. Stop at the
      // last ticket rather than looping, and let the caller see something
      // truthful instead of a timeout.
      return current.id;
    }

    seen.add(nextId);

    const next = await Ticket.findByPk(nextId);
    if (!next) return current.id;

    current = next;
  }

  return current.id;
}

/**
 * Whether the actor may take a given edge.
 *
 * `tickets:close` is CONDITIONAL: the key alone lets an Agent close their own
 * work, and closing a ticket assigned to someone else additionally requires
 * `tickets:manage_any` (Clarifications Q2). That condition cannot live in a
 * route gate, which is why the matrix test exempts the key and names this
 * service's test instead.
 */
async function mayTakeEdge(
  permission: PermissionKey,
  actor: LifecycleActor,
  ticket: Ticket,
): Promise<boolean> {
  // THE SYSTEM HOLDS NO ROLE, so there is no permission to look up (Phase 6,
  // research D8). This is not a bypass and must not become one by accident:
  // automation reaches here only through an action the closed catalog names,
  // and the LIFECYCLE ITSELF still governs — an undeclared edge is refused
  // below this function, for the system exactly as for a person. What is
  // skipped is the ROLE question, which has no meaning without a role.
  if (actor.id === null) {
    return true;
  }

  if (!(await authorizationService.roleHasPermission(actor.roleId as number, permission))) {
    return false;
  }

  if (permission === 'tickets:close') {
    const isOwn = ticket.assignee_user_id === actor.id;

    if (!isOwn) {
      return authorizationService.roleHasPermission(actor.roleId as number, 'tickets:manage_any');
    }
  }

  return true;
}

/**
 * The moves available TO THIS ACTOR on THIS TICKET.
 *
 * Filtered by permission, so the interface never renders a button that would
 * then fail — offering a move the user cannot make is the interface lying
 * about authority, which Phase 1 rejected.
 */
export async function availableTransitions(
  actor: LifecycleActor,
  ticket: Ticket,
): Promise<TicketStatus[]> {
  // A merged ticket has no available moves at all, whatever its status says.
  if (ticket.merged_into_ticket_id !== null) return [];

  const from: TicketStatus = ticket.status;
  const available: TicketStatus[] = [];

  for (const edge of TRANSITIONS[from]) {
    if (await mayTakeEdge(edge.permission, actor, ticket)) {
      available.push(edge.to);
    }
  }

  return available;
}

/**
 * The gate. Throws, or returns the edge that was taken.
 *
 * Order matters and is stated in contracts/ticket-lifecycle.md:
 *   1. merged      — applies regardless of which move was asked for
 *   2. declared    — is this pair in the table at all
 *   3. permitted   — does the actor hold the edge's permission
 *
 * Steps 2 and 3 produce DIFFERENT errors on purpose. "This move is not
 * possible" and "this move is not yours" are different problems with different
 * remedies, and collapsing them would leave a Supervisor unable to tell whether
 * to reopen the ticket or to ask someone else to.
 */
export async function assertTransitionAllowed(
  ticket: Ticket,
  to: unknown,
  actor: LifecycleActor,
): Promise<{ from: TicketStatus; to: TicketStatus; permission: PermissionKey }> {
  await assertWorkable(ticket);

  const from = ticket.status;

  if (!isTicketStatus(to)) {
    // Not a status at all. Refused the same way an undeclared pair is, and the
    // message still names where the ticket can actually go.
    throw transitionNotAllowed(from, String(to), await availableTransitions(actor, ticket));
  }

  const edge = edgeFor(from, to);

  if (!edge) {
    throw transitionNotAllowed(from, to, await availableTransitions(actor, ticket));
  }

  if (!(await mayTakeEdge(edge.permission, actor, ticket))) {
    throw forbidden();
  }

  return { from, to, permission: edge.permission };
}
