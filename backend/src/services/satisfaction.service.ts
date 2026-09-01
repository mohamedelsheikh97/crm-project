import { UniqueConstraintError } from 'sequelize';

import { alreadyRecorded, validationError, type ErrorDetail } from '../errors/app-error.js';
import { TicketSatisfaction } from '../models/index.js';
import { isSettled } from '../portal/customer-status.js';
import {
  isSatisfactionScore,
  SATISFACTION_COMMENT_MAX_LENGTH,
  SATISFACTION_MAX,
  SATISFACTION_MIN,
} from '../portal/satisfaction.js';

import type { PortalSessionContext } from './portal-auth.service.js';
import * as portalTicketService from './portal-ticket.service.js';

/**
 * Post-resolution satisfaction (Phase 8, FR-047 - FR-055, research.md D8).
 *
 * The whole service is short, and the two lines that matter are the ones that
 * do nothing clever:
 *
 *   - THE INSERT IS ATTEMPTED, NOT PRECEDED BY A LOOKUP. `at most one per ticket`
 *     is the unique index on `ticket_id`, and catching its violation is what
 *     makes FR-049 true. A check-then-insert passes every test and still admits
 *     two rows when a customer double-clicks — which is not a hypothetical: it is
 *     the single commonest way a form gets submitted twice.
 *
 *   - THE TICKET IS RESOLVED THROUGH `findScoped`. A rating on a request this
 *     contact does not own gets the identical 404 a nonexistent reference gets
 *     (FR-055, FR-017), because the alternative confirms that somebody else's
 *     request exists.
 *
 * NOTHING HAPPENS IF NOBODY RATES (FR-051). There is no invitation record, no
 * reminder, no scheduled sweep, and no column on `tickets` recording that we
 * asked. The prompt is a property of the ticket's state, computed on read — so
 * "ignored" costs exactly nothing and cannot escalate into a nag.
 */

export interface SatisfactionView {
  score: number;
  comment: string | null;
  submittedAt: Date;
}

export async function submit(
  session: PortalSessionContext,
  reference: unknown,
  input: { score?: unknown; comment?: unknown },
): Promise<SatisfactionView> {
  const ticket = await portalTicketService.findScoped(session, reference);

  const details: ErrorDetail[] = [];

  if (!isSatisfactionScore(Number(input.score))) {
    details.push({
      field: 'score',
      message: `portal.rating.error.scoreRequired:${SATISFACTION_MIN}-${SATISFACTION_MAX}`,
    });
  }

  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';

  if (comment.length > SATISFACTION_COMMENT_MAX_LENGTH) {
    details.push({
      field: 'comment',
      message: `portal.rating.error.commentTooLong:${SATISFACTION_COMMENT_MAX_LENGTH}`,
    });
  }

  if (details.length > 0) throw validationError(details);

  // FR-047. Checked against the SAME declaration the interface uses to decide
  // whether to offer the control, so the screen and the endpoint cannot
  // disagree about which states are rateable.
  if (!isSettled(ticket.status)) {
    throw validationError([{ field: 'reference', message: 'portal.error.notResolved' }]);
  }

  try {
    const created = await TicketSatisfaction.create({
      ticket_id: ticket.id,
      score: Number(input.score),
      comment: comment === '' ? null : comment,
      submitted_by_contact_id: session.contactId,
      submitted_at: new Date(),
    });

    return {
      score: created.score,
      comment: created.comment,
      submittedAt: created.submitted_at,
    };
  } catch (error) {
    // THE RACE, CAUGHT WHERE IT ACTUALLY HAPPENS. This is also FR-054's answer:
    // a reopened, re-resolved ticket hits the same index and the first response
    // stands — chosen over "the latest wins" because the alternative lets a
    // score change after Phase 10 has counted it, and because a customer who has
    // already said the answer was wrong has not withdrawn that by being asked
    // again.
    if (error instanceof UniqueConstraintError) throw alreadyRecorded();

    throw error;
  }
}

/** What staff see on the ticket (FR-053). */
export async function forTicket(ticketId: number): Promise<SatisfactionView | null> {
  const row = await TicketSatisfaction.findOne({ where: { ticket_id: ticketId } });

  return row ? { score: row.score, comment: row.comment, submittedAt: row.submitted_at } : null;
}
