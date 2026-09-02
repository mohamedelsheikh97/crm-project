import type { TicketDetail, TicketSummary } from '../../../services/ticket.service.js';

/**
 * Service output → the published ticket shape (Phase 11, FR-010, research D6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MERGED TICKET IS THE INTERESTING CASE, AND IT IS WHY FR-010 MATTERS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 3 merges tickets: the absorbed one becomes a redirect to a survivor.
 * The published interface returns the REQUESTED ticket with
 * `merged_into_ticket_id` set — the same thing the screens show.
 *
 * The failure mode this avoids is arithmetic. Returning the SURVIVOR'S row under
 * the requested id would make a client count the same work twice in whatever
 * system it synchronises into, and nothing would ever correct it. Returning the
 * requested row with its pointer is not a duplicate of anything: the client sees
 * the ticket it asked for, sees that it was absorbed, and can follow it.
 *
 * An earlier draft of the contract specified `409` here. That was wrong, and
 * worth recording rather than quietly fixing: reads do not raise
 * `TicketMergedError` at all — it comes from `ticket-lifecycle.service.ts` on a
 * WRITE attempt — and answering 409 would have made this surface disagree with
 * the screens about what a merge is, which is precisely what FR-010 forbids.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SLA OUTCOME IS READ AS RECORDED. NEVER RECOMPUTED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 6 writes `response_satisfied_at` / `response_breached_at` write-once,
 * and Phase 10's research D3 established that the report reads those columns
 * rather than recalculating from a clock. Same rule here, for the same reason:
 * two calculations of "was this breached?" agree on the day they are written and
 * drift on the first change to either — and when they disagree, the published
 * answer is the one an outside system has already acted on.
 */

export interface PublishedTicket {
  readonly id: number;
  /** `TKT-000042` — derived from the id, never stored (Phase 3). */
  readonly reference: string;
  readonly subject: string;
  readonly category: string;
  readonly priority: string;
  readonly status: string;
  readonly customer: { readonly id: number; readonly display_name: string } | null;
  /**
   * The CURRENT assignee, matching the attribution rule Phase 10's agent report
   * states in its own payload (research D4). A client reconciling workload needs
   * the same rule the reports use, or the two disagree.
   */
  readonly assignee: { readonly id: number; readonly full_name: string } | null;
  /**
   * Present and non-null means this ticket was absorbed into another.
   *
   * Both the detail and the COLLECTION return merged tickets — the collection
   * unlike the internal working list, which excludes them because a queue full
   * of redirects is not a queue. A synchronising client must learn that a ticket
   * it holds was merged, and hiding the row would leave its copy open forever.
   */
  readonly merged_into_ticket_id: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PublishedTicketDetail extends PublishedTicket {
  readonly description: string | null;
  readonly source: string | null;
  readonly due_at: string | null;
  /** As recorded by Phase 6. Null where no promise was made or none is decided. */
  readonly sla: {
    readonly response_outcome: 'met' | 'breached' | 'pending' | null;
    readonly resolution_outcome: 'met' | 'breached' | 'pending' | null;
  } | null;
}

export function ticket(summary: TicketSummary): PublishedTicket {
  return {
    id: summary.id,
    reference: summary.reference,
    subject: summary.subject,
    category: summary.category,
    priority: summary.priority,
    status: summary.status,
    customer: summary.customer
      ? { id: summary.customer.id, display_name: summary.customer.displayName }
      : null,
    assignee: summary.assignee
      ? { id: summary.assignee.id, full_name: summary.assignee.fullName }
      : null,
    merged_into_ticket_id: summary.mergedIntoTicketId,
    created_at: summary.createdAt.toISOString(),
    updated_at: summary.updatedAt.toISOString(),
  };
}

/**
 * Classifies a recorded promise. BREACH WINS OVER SATISFACTION.
 *
 * Phase 6 writes both columns write-once, so a target breached and then
 * satisfied late has both set — and it was still breached. Counting it as met
 * would make the published answer disagree with both the ticket screen and
 * Phase 10's SLA report, which apply exactly this rule (`report-sla.service.ts`).
 */
function outcome(
  satisfiedAt: Date | string | null | undefined,
  breachedAt: Date | string | null | undefined,
): 'met' | 'breached' | 'pending' | null {
  if (satisfiedAt === undefined && breachedAt === undefined) return null;
  if (breachedAt) return 'breached';
  if (satisfiedAt) return 'met';

  return 'pending';
}

export function ticketDetail(detail: TicketDetail): PublishedTicketDetail {
  const sla = (detail as unknown as { sla?: Record<string, Date | string | null> }).sla;

  return {
    ...ticket(detail),
    description: detail.description,
    source: (detail as unknown as { source?: string | null }).source ?? null,
    due_at: (detail as unknown as { dueAt?: Date | null }).dueAt?.toISOString() ?? null,
    sla: sla
      ? {
          response_outcome: outcome(sla.responseSatisfiedAt, sla.responseBreachedAt),
          resolution_outcome: outcome(sla.resolutionSatisfiedAt, sla.resolutionBreachedAt),
        }
      : null,
  };
}
