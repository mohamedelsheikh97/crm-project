import { conversationLang, type ContentLang } from '../ai/lang.js';
import { invoke } from '../ai/invoke.js';
import * as prompt from '../ai/prompts/summarise.js';
import { externalProviderFor } from '../ai/providers/external-factory.js';
import { Message } from '../models/message.model.js';
import { Ticket } from '../models/ticket.model.js';

import * as ticketService from './ticket.service.js';

/**
 * Ticket thread summarisation (Phase 9, US1, FR-019 - FR-024).
 *
 * COMPUTED ON READ, STORED NOWHERE (research D7, FR-065b). Phase 7 recorded the
 * reason for suggestions and it is stronger here: a stored suggestion goes stale
 * when an article is archived, but a stored summary goes stale on the next
 * inbound message — and a stale summary of a live ticket is actively misleading
 * in a way an empty panel is not.
 *
 * Recomputation also disposes of FR-018's staleness problem outright. A summary
 * computed now cannot be older than the thread it describes, so there is no
 * "generated at" to reconcile against "last message at".
 *
 * INTERNAL NOTES CANNOT REACH THIS PROMPT, and not because a filter excludes
 * them. `messages` has no `is_internal` column — Phase 4 put internal notes in
 * `ticket_notes`, a separate table, and message.model.ts says in writing that no
 * such flag is to be added. So FR-023 holds structurally: there is nothing to
 * filter and no query here that could forget to.
 */
export interface TicketSummary {
  readonly text: string;
  readonly contentLang: ContentLang;
  readonly generatedAt: Date;
  readonly messageCount: number;
}

/** Below this, the thread is shorter than any summary of it would be. */
const MIN_MESSAGES = 3;

export class SummaryNotWorthwhileError extends Error {
  constructor() {
    super('thread too short to summarise');
    this.name = 'SummaryNotWorthwhileError';
  }
}

export async function forTicket(
  ticketId: number,
  requestedBy: number,
  preferredLang?: ContentLang,
): Promise<TicketSummary> {
  // Visibility first, and by the SAME path the ticket detail endpoint uses, so
  // a ticket the caller may not view refuses identically here (FR-020). This
  // throws NotFound, which the controller renders as 404 — never 403, because a
  // 403 tells you the ticket exists.
  await ticketService.getById(ticketId);

  const ticket = (await Ticket.findByPk(ticketId)) as Ticket;

  // The whole thread, not a page of it (FR-021). A summary of the first fifty
  // messages, silently presented as a summary of the ticket, is worse than no
  // summary — so this deliberately does not reuse the paginated list.
  const rows = await Message.findAll({
    where: { ticket_id: ticketId },
    order: [
      ['occurred_at', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  if (rows.length < MIN_MESSAGES) {
    throw new SummaryNotWorthwhileError();
  }

  const messages = rows.map((row) => ({
    direction: row.direction as 'inbound' | 'outbound',
    occurredAt: row.occurred_at,
    body: row.body,
  }));

  // Content follows the SOURCE, not the reader (research D9, FR-057). The
  // reader may override to obtain the other language (FR-024), which is an
  // explicit request rather than a silent translation.
  const contentLang = preferredLang ?? conversationLang(messages);

  const result = await invoke(
    externalProviderFor(),
    {
      feature: 'summary',
      system: prompt.system(contentLang),
      messages: prompt.messages({
        subject: ticket.subject,
        createdAt: ticket.created_at,
        messages,
      }),
      maxOutput: 1024,
      contentLang,
    },
    { subjectType: 'ticket', subjectId: ticketId, requestedBy },
  );

  return {
    text: result.text,
    contentLang,
    generatedAt: new Date(),
    messageCount: rows.length,
  };
}
