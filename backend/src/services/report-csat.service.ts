import { col, fn, Op } from 'sequelize';

import { figure, type Figure, type ResolvedPeriod } from '../reporting/figure.js';
import { describe as describeFilters, type ReportFilters } from '../reporting/filters.js';
import * as sources from '../reporting/sources.js';
import { isSuppressed, rate } from '../reporting/suppression.js';
import { RESOLVED_STATUSES } from '../sla/clock.js';
import { toReference } from '../tickets/reference.js';

/**
 * Customer satisfaction reporting (Phase 10, US4, FR-026 - FR-029).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO THINGS THIS REPORT GETS WRONG IF NOBODY IS CAREFUL.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. THE DENOMINATOR. A response rate computed over the responses is always
 *    100%. The denominator is every ticket that COULD have been rated (FR-027),
 *    and the unrated ones have no row in `ticket_satisfaction` at all — so the
 *    query that feels natural omits precisely the records the figure exists to
 *    count. The population comes from `sources.rateableIn`.
 *
 * 2. THE SAMPLE. "Average satisfaction: 4.0" over one response is not a
 *    statistic, and it is indistinguishable on screen from the same number over
 *    four hundred. Below the floor the average is WITHHELD and the count shown
 *    instead (FR-029) — `suppression.ts` owns that decision so it is the same
 *    rule the agent report uses.
 *
 * Reads only through `reporting/sources.ts` (research D2, FR-007).
 */

/** The 1-5 scale, declared so every score is a bucket even at zero. */
export const CSAT_SCORES = [1, 2, 3, 4, 5] as const;

/**
 * The neutral midpoint of the scale.
 *
 * Exported because the chart needs it: CSAT 1-5 is an ORDERED scale, so its
 * form is a diverging stacked bar centred on neutral, not five independent
 * categories in a column chart (research D7).
 */
export const CSAT_NEUTRAL = 3;

export interface CsatComment {
  /**
   * `TKT-000042`, never the internal id (FR-028).
   *
   * A comment is the one place in this phase where customer-authored text
   * reaches a report, and it is read by somebody who will want to open the
   * ticket. The reference is what they can act on; a primary key is an
   * implementation detail that also happens to be a guessable enumeration.
   */
  readonly ticketReference: string;
  readonly score: number;
  readonly comment: string;
  readonly submittedAt: Date;
}

export interface CsatReport {
  readonly distribution: Figure<Array<{ score: number; count: number }>>;
  readonly average: Figure<number | null>;
  readonly responseRate: Figure<number | null>;
  readonly comments: Figure<CsatComment[]>;
}

export async function report(period: ResolvedPeriod, filters: ReportFilters): Promise<CsatReport> {
  const described = describeFilters(filters);

  const build = <T>(
    value: T,
    count: number,
    total: number,
    options: {
      excluded?: Array<{ reason: string; count: number }>;
      suppressed?: boolean;
    } = {},
  ) =>
    figure(
      { value, count, total, excluded: options.excluded ?? [], suppressed: options.suppressed },
      period,
      described,
    );

  const responseWhere = sources.satisfactionIn(period);

  const rows = (await sources.models.TicketSatisfaction.findAll({
    where: responseWhere,
    attributes: ['score', [fn('COUNT', col('id')), 'n']],
    group: ['score'],
    raw: true,
  })) as unknown as Array<Record<string, unknown>>;

  const counted = new Map<number, number>();

  for (const row of rows) {
    counted.set(Number(row.score), Number(row.n));
  }

  /**
   * EVERY SCORE IS A BUCKET, including the ones nobody gave.
   *
   * A `GROUP BY` returns only the scores that occurred, so a month with no 1s
   * would render a four-segment bar — and the reader would have no way to see
   * that the missing segment is zero rather than absent from the scale.
   */
  const distribution: Array<{ score: number; count: number }> = CSAT_SCORES.map((score) => ({
    score,
    count: counted.get(score) ?? 0,
  }));

  const responses = distribution.reduce((sum, bucket) => sum + bucket.count, 0);

  /**
   * THE DENOMINATOR: settled tickets, not responses (FR-027).
   *
   * `RESOLVED_STATUSES` comes from `sla/clock.ts`. Writing `['resolved',
   * 'closed']` here would be a second definition of "finished" that agrees
   * today and drifts on the first change to Phase 6.
   */
  const rateable = await sources.models.Ticket.count({
    where: sources.rateableIn(period, filters, RESOLVED_STATUSES),
  });

  const unrated = Math.max(rateable - responses, 0);

  /**
   * The average, WITHHELD below the floor (FR-029).
   *
   * `null` rather than a number, because rendering "we cannot say" as 0.0 or as
   * an unqualified 4.0 are both claims the sample does not support. The count
   * still travels in the envelope, so the surface has something true to show.
   */
  const sum = distribution.reduce((total, bucket) => total + bucket.score * bucket.count, 0);
  const average = isSuppressed(responses) ? null : sum / responses;

  /**
   * COMMENTS ARE CAPPED AND ORDERED, and carry a reference rather than an id.
   *
   * Newest first, because a comment's usefulness decays: what a customer said
   * last week is actionable and what they said in January is history. The cap
   * keeps a busy month from returning ten thousand rows of customer-authored
   * text into a browser.
   */
  const commentRows = await sources.models.TicketSatisfaction.findAll({
    where: { ...responseWhere, comment: { [Op.not]: null } },
    attributes: ['ticket_id', 'score', 'comment', 'submitted_at'],
    order: [['submitted_at', 'DESC']],
    limit: 200,
    raw: true,
  });

  const comments: CsatComment[] = commentRows
    .filter((row) => typeof row.comment === 'string' && row.comment.trim() !== '')
    .map((row) => ({
      ticketReference: toReference(row.ticket_id),
      score: Number(row.score),
      comment: String(row.comment),
      submittedAt: row.submitted_at instanceof Date ? row.submitted_at : new Date(row.submitted_at),
    }));

  const unratedExclusion = unrated > 0 ? [{ reason: 'not_rated', count: unrated }] : [];

  return {
    distribution: build(distribution, responses, responses),
    average: build(average, responses, responses, { suppressed: isSuppressed(responses) }),
    /**
     * `rate()` returns null below the floor for the same reason the average
     * does — and the exclusion states how many were never rated, so the reader
     * can see the gap rather than infer it from a number that looks complete
     * (FR-004).
     */
    responseRate: build(rate(responses, rateable), responses, rateable, {
      excluded: unratedExclusion,
      suppressed: isSuppressed(rateable),
    }),
    comments: build(comments, comments.length, responses),
  };
}
