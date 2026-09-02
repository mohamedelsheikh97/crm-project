import { QueryTypes, type Transaction } from 'sequelize';

import { predominantLang } from '../ai/lang.js';
import { sequelize } from '../config/database.js';
import { normaliseForIndex, normaliseQuery } from '../lib/text-normalise.js';
import { Ticket } from '../models/ticket.model.js';
import { toReference } from '../tickets/reference.js';

/**
 * Similar resolved tickets (Phase 9, US5, FR-051 - FR-055).
 *
 * NO MODEL CALL, AND NO `ai_invocations` ROW. This is retrieval, and the
 * research (D8) states the case: a model would make every property this feature
 * needs worse. Visibility would become post-filtering — the exact thing Phase
 * 8's FR-016 forbade — results could not be asserted by id, "nothing similar"
 * would still produce something, and it would cost money on every ticket view.
 *
 * The feature lives under "AI Features" because PLAN.md puts it there. The
 * honest implementation is Phase 7's token index pointed at ticket text.
 *
 * ON FR-052, ACCURATELY. The requirement is that suggestions respect "the
 * viewer's EXISTING ticket visibility", and in this system that visibility is
 * `tickets:view` and nothing narrower: staff holding it may open any ticket,
 * and `tickets/ownership.matrix` scopes only notifications and tasks, which are
 * personal records. There is therefore no per-row predicate to add here — the
 * route's `requirePermission('tickets:view')` IS the visibility rule, and this
 * service is reached only through it.
 *
 * This is worth stating rather than implying, because the obvious reading of
 * FR-052 is that a scoping clause belongs in the query below, and its absence
 * would otherwise look like the omission SC-014 exists to catch. If a later
 * phase introduces per-agent or per-department ticket visibility — Phase 12
 * makes RBAC department-aware — THIS QUERY IS ONE OF THE PLACES THAT MUST GAIN
 * A PREDICATE, and `backend/tests/similar/visibility.test.ts` is where the gap
 * would show.
 */
export interface SimilarTicket {
  readonly ticketId: number;
  readonly reference: string;
  readonly subject: string;
  /** There is no `resolved_at` column; the update timestamp is the closest
   *  honest signal of when the ticket last moved. */
  readonly resolvedAt: Date | null;
  readonly resolutionExcerpt: string | null;
  readonly score: number;
}

const FIELD_WEIGHTS = { subject: 3, body: 1 } as const;
const MAX_RESULTS = 5;

/**
 * Below this, matches are noise. Phase 7 flagged its own floor as the number
 * whose wrong value fails invisibly; the same caution applies here, though the
 * consequence is milder — a weak suggestion an agent ignores, rather than a
 * fabricated answer to a customer.
 */
const SCORE_FLOOR = 1.5;

/** States worth learning from. An open ticket has no resolution to offer. */
const SETTLED = ['resolved', 'closed'];

interface ScoredRow {
  ticket_id: number;
  score: string | number;
  matched: string | number;
}

/**
 * Rebuilds one ticket's index rows, inside the caller's transaction.
 *
 * Called when a ticket reaches or leaves a settled state, following Phase 7's
 * reindex pattern: delete then insert, within the writing transaction, so the
 * index cannot disagree with the row that produced it.
 */
export async function reindex(ticketId: number, transaction: Transaction): Promise<void> {
  await sequelize.query('DELETE FROM ticket_terms WHERE ticket_id = :ticketId', {
    replacements: { ticketId },
    transaction,
  });

  const ticket = await Ticket.findByPk(ticketId, { transaction });

  if (!ticket || !SETTLED.includes(ticket.status)) return;

  const subject = ticket.subject ?? '';
  const body = ticket.description ?? '';
  const lang = predominantLang(`${subject} ${body}`);

  const rows = [
    ...normaliseForIndex(subject).map((token) => ({ ...token, field: 'subject' as const })),
    ...normaliseForIndex(body).map((token) => ({ ...token, field: 'body' as const })),
  ];

  if (rows.length === 0) return;

  const now = new Date();

  await sequelize.query(
    `INSERT INTO ticket_terms (ticket_id, term, field, hits, lang, created_at, updated_at)
     VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    {
      replacements: rows.flatMap((row) => [
        ticketId,
        row.term.slice(0, 64),
        row.field,
        row.hits,
        lang,
        now,
        now,
      ]),
      transaction,
    },
  );
}

/** Tickets resembling this one. Reached only behind `tickets:view`. */
export async function forTicket(ticketId: number): Promise<SimilarTicket[]> {
  const ticket = await Ticket.findByPk(ticketId);

  if (!ticket) return [];

  const terms = normaliseQuery(`${ticket.subject ?? ''} ${ticket.description ?? ''}`);

  if (terms.length === 0) return [];

  const lang = predominantLang(`${ticket.subject ?? ''} ${ticket.description ?? ''}`);

  const scored = await sequelize.query<ScoredRow>(
    `SELECT t.ticket_id,
            SUM(CASE t.field WHEN 'subject' THEN :subjectWeight ELSE :bodyWeight END * t.hits) AS score,
            COUNT(DISTINCT t.term) AS matched
       FROM ticket_terms t
       JOIN tickets tk ON tk.id = t.ticket_id
      WHERE t.term IN (:terms)
        AND t.lang = :lang
        -- Never suggest the ticket the agent is already reading.
        AND t.ticket_id <> :ticketId
        -- Settled only. Unsettled tickets have no rows at all, so this is a
        -- belt-and-braces predicate rather than the control.
        AND tk.status IN (:settled)
      GROUP BY t.ticket_id`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        terms,
        lang,
        ticketId,
        settled: SETTLED,
        subjectWeight: FIELD_WEIGHTS.subject,
        bodyWeight: FIELD_WEIGHTS.body,
      },
    },
  );

  /**
   * The fraction-matched multiplier, copied from Phase 7's ranking and for its
   * reason: without it a long ticket containing one of the reader's five words
   * outranks a short one containing all five, simply because it has more text.
   */
  const ranked = scored
    .map((row) => ({
      ticketId: row.ticket_id,
      score: (Number(row.score) * Number(row.matched)) / terms.length,
    }))
    .filter((row) => row.score >= SCORE_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);

  if (ranked.length === 0) return [];

  const tickets = await Ticket.findAll({ where: { id: ranked.map((row) => row.ticketId) } });
  const byId = new Map(tickets.map((row) => [row.id, row]));

  return ranked.flatMap((row) => {
    const match = byId.get(row.ticketId);
    if (!match) return [];

    return [
      {
        ticketId: match.id,
        reference: toReference(match.id),
        subject: match.subject,
        resolvedAt: match.updated_at ?? null,
        resolutionExcerpt: excerpt(match.description),
        score: Number(row.score.toFixed(3)),
      },
    ];
  });
}

function excerpt(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}
