import { Op, literal } from 'sequelize';

import { sequelize } from '../config/database.js';
import { notFound, staleRecord, validationError } from '../errors/app-error.js';
import { Ticket, TicketSla } from '../models/index.js';
import { toReference } from '../tickets/reference.js';
import * as auditService from './audit.service.js';
import * as historyService from './ticket-history.service.js';
import * as lifecycleService from './ticket-lifecycle.service.js';
import type { Actor, AuditContext, TicketDetail } from './ticket.service.js';
import { getById } from './ticket.service.js';

/**
 * Due dates: everything that reads or writes `tickets.due_at`.
 *
 * A SEPARATE SERVICE from ticket.service.ts on purpose, and not because that
 * file is long. Phase 4 wrote: "This is the seam Phase 6 replaces (FR-028): in
 * this phase a due date is a promise a person made, and in Phase 6 it becomes a
 * target a policy computed."
 *
 * PHASE 6 HAS NOW USED THAT SEAM, and it is worth recording exactly how,
 * because the shape is not what the sentence above implies:
 *
 *   - The resolution target POPULATES `due_at`, written by
 *     sla-target.service.ts, but ONLY while `due_source` is `policy`.
 *   - A date a person sets here flips `due_source` to `manual` PERMANENTLY, and
 *     no later policy evaluation touches it again (FR-024a). A commitment
 *     negotiated with a customer outranks one a policy computed.
 *   - Clearing a manual override returns the ticket to the computed target
 *     rather than to no date at all (FR-024d).
 *
 * So the value has two possible authors rather than one, and `due_source`
 * records which. Everything downstream — the queue sort, the overdue indicator,
 * the warning sweep — still reads `due_at` and nothing else, and none of it was
 * rebuilt. Phase 4's rule still stands and is now load-bearing rather than
 * hypothetical: NOTHING HERE OR DOWNSTREAM MAY ASSUME A HUMAN SET THE DATE.
 */

/**
 * `now` is a parameter rather than a `new Date()` inside each function.
 *
 * FR-020 requires one authoritative clock — "overdue" must mean the same thing
 * for a viewer in Cairo and a viewer in London, so it can never be computed
 * from a browser. Passing it also makes the scheduler testable without waiting
 * on a timer.
 */
export function isOverdue(ticket: Ticket, now: Date = new Date()): boolean {
  if (ticket.due_at === null) return false;
  // FR-027: a Closed ticket is finished. Reporting it as late is noise about
  // work nobody is going to do.
  if (ticket.status === 'closed') return false;

  return ticket.due_at.getTime() < now.getTime();
}

/** The SQL predicate matching `isOverdue`, for filtering in the database. */
export function overdueWhere(now: Date = new Date()): Record<symbol | string, unknown> {
  return {
    due_at: { [Op.ne]: null, [Op.lt]: now },
    status: { [Op.ne]: 'closed' },
  };
}

/**
 * Ordering by due date with a stable home for tickets that have none (FR-023).
 *
 * MySQL sorts NULL first ascending and last descending, so without the leading
 * expression "no due date" would drift from one end of the queue to the other
 * as the user toggles direction — which reads as a bug even though each sort is
 * individually correct. The leading `IS NULL` pins them to the bottom in both
 * directions, so toggling changes the order of DATED tickets only.
 */
export function dueDateOrder(
  direction: 'ASC' | 'DESC',
): Array<[ReturnType<typeof literal> | string, string]> {
  return [
    [literal('(`Ticket`.`due_at` IS NULL)'), 'ASC'],
    ['due_at', direction],
    ['id', 'DESC'],
  ];
}

export interface SetDueDateInput {
  /** ISO 8601, or null to clear it (FR-026). */
  dueAt: string | null;
  version: unknown;
}

function parseDueAt(value: string | null): Date | null {
  if (value === null) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw validationError([{ field: 'dueAt', message: 'ticket.error.dueDateInvalid' }]);
  }

  // Deliberately NO past-date check (FR-024). Backdating a commitment that was
  // already missed is legitimate — often it is the whole reason someone is
  // setting a date at all — and refusing it would force the user to lie about
  // when the work was due.

  // Milliseconds are dropped because MySQL DATETIME is second-precision. If we
  // kept them, three things would quietly disagree: the history entry would
  // record a value the column cannot hold, `due_warning_sent_for <> due_at`
  // would compare a truncated column against an untruncated one, and re-saving
  // the same date would look like a change — re-arming a warning that should
  // not fire again (FR-045). Truncating at the boundary makes all three agree.
  parsed.setMilliseconds(0);

  return parsed;
}

/**
 * Set, change, or clear a ticket's due date.
 *
 * Gated by `tickets:set_due_date` at the route (FR-025). The permission is
 * separate from `tickets:view` so that reading a queue never implies the
 * authority to change what is late (FR-075).
 */
export async function setDueDate(
  id: number,
  input: SetDueDateInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<TicketDetail> {
  const ticket = await Ticket.findByPk(id);

  if (!ticket) throw notFound();

  // A merged ticket is a redirect, not workable by any route (Phase 3 FR-043).
  await lifecycleService.assertWorkable(ticket);

  const version = Number(input.version);

  if (!Number.isInteger(version) || version !== ticket.version) {
    throw staleRecord();
  }

  const previous = ticket.due_at;
  const next = parseDueAt(input.dueAt);

  const unchanged =
    (previous === null && next === null) ||
    (previous !== null && next !== null && previous.getTime() === next.getTime());

  if (unchanged) {
    // Explicitly a no-op rather than a rewrite. Re-saving the same date must
    // not produce a history entry, and — via due_warning_sent_for — must not
    // re-arm the approaching-due warning either (FR-045).
    return getById(ticket.id);
  }

  // Three events rather than one, because "someone put a date on this",
  // "someone moved it", and "someone took it off" read differently to the
  // person catching up on the ticket.
  const event =
    next === null
      ? historyService.TICKET_EVENTS.DUE_DATE_CLEARED
      : previous === null
        ? historyService.TICKET_EVENTS.DUE_DATE_SET
        : historyService.TICKET_EVENTS.DUE_DATE_CHANGED;

  await sequelize.transaction(async (transaction) => {
    if (next === null) {
      // Phase 6 (FR-024d): CLEARING AN OVERRIDE RETURNS THE TICKET TO ITS
      // COMPUTED TARGET, not to no date at all. "I withdraw my own promise" and
      // "this ticket has no commitment" are different intentions, and only the
      // first is what clearing a manual date means once policies exist.
      //
      // A ticket that matches no policy still ends with no date, because the
      // row does not exist — FR-014 again.
      const computed = await TicketSla.findByPk(ticket.id, { transaction });

      ticket.due_source = 'policy';
      ticket.due_at = computed?.resolution_target_at ?? null;
    } else {
      // FR-024a: a date a person typed is a commitment they made. It outranks
      // the policy from here on, and no recomputation will overwrite it.
      ticket.due_source = 'manual';
      ticket.due_at = next;
    }

    // Moving the date to a genuinely new value ARMS A NEW WARNING; clearing it
    // leaves the marker harmlessly behind, because the sweep never matches a
    // NULL due_at. Only an identical re-save (handled above) leaves it alone.
    ticket.due_warning_sent_for = null;

    await ticket.save({ transaction });

    await historyService.record(
      {
        ticketId: ticket.id,
        event,
        actor,
        field: 'dueAt',
        previousValue: previous === null ? null : previous.toISOString(),
        newValue: next === null ? null : next.toISOString(),
      },
      transaction,
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.TICKET_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        previousValue: { dueAt: previous === null ? null : previous.toISOString() },
        newValue: { dueAt: next === null ? null : next.toISOString() },
        ...context,
      },
      transaction,
    );
  });

  return getById(ticket.id);
}

/**
 * Tickets whose due date is close enough to warn their assignee about, and that
 * have not already been warned for THIS date (FR-045).
 *
 * The last clause is the whole design, and the reason `due_warning_sent_for`
 * stores a date rather than a boolean:
 *
 *   - re-saving the same date does not re-fire (the values still match)
 *   - rescheduling arms a new warning (they no longer match)
 *   - a cleared date warns about nothing (NULL due_at matches nothing)
 *
 * Do not simplify this to a flag. A flag cannot tell a re-save from a
 * reschedule.
 */
export async function ticketsDueSoon(now: Date, leadMinutes: number): Promise<Ticket[]> {
  const threshold = new Date(now.getTime() + leadMinutes * 60_000);

  return Ticket.findAll({
    where: {
      due_at: { [Op.ne]: null, [Op.lte]: threshold },
      // Closed tickets are finished (FR-027); merged ones are redirects.
      status: { [Op.ne]: 'closed' },
      merged_into_ticket_id: null,
      // Nobody to warn otherwise. An unassigned ticket running late is a
      // supervision problem, and there is no supervision surface in this phase.
      assignee_user_id: { [Op.ne]: null },
      // Written as a literal because the comparison is column-to-column.
      // Sequelize's operators compare a column to a VALUE; expressing
      // "due_warning_sent_for <> due_at" through them produces a bound
      // parameter holding the string "due_at", which silently matches nothing
      // and would make the warning never fire.
      [Op.and]: literal(
        '(`Ticket`.`due_warning_sent_for` IS NULL ' +
          'OR `Ticket`.`due_warning_sent_for` <> `Ticket`.`due_at`)',
      ),
    },
  });
}
