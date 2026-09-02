import { conversationLang, type ContentLang } from '../ai/lang.js';
import { invoke } from '../ai/invoke.js';
import * as prompt from '../ai/prompts/draft-reply.js';
import { externalProviderFor } from '../ai/providers/external-factory.js';
import { Message } from '../models/message.model.js';
import { Ticket } from '../models/ticket.model.js';

import * as searchService from './kb-search.service.js';
import * as ticketService from './ticket.service.js';

/**
 * Suggested reply drafting (Phase 9, US2, FR-025 - FR-032).
 *
 * A DRAFT HAS NO EXISTENCE. It is not stored, not queued, not given an id, and
 * not recorded as a message (FR-026, FR-065c). It becomes a message only when
 * the agent sends it through the unchanged Phase 5 path, at which point it is
 * an ordinary message authored by them (FR-027) — with no AI marker, because
 * they sent it and they own it.
 *
 * GROUNDED IN THE TICKET AND IN AGENT-VISIBLE KB CONTENT. The audience passed
 * to retrieval is `'internal'`, not `'customer'`: an agent may draft from
 * material a customer may not read, and the citation list returned to them is
 * material they are entitled to see (FR-016, FR-029). The assistant is the
 * surface where `'customer'` is the literal — a different service, a different
 * provider, a different corpus.
 */
export interface CitedArticle {
  readonly id: number;
  readonly slug: string | null;
  readonly title: string;
}

export interface ReplyDraft {
  readonly text: string;
  readonly contentLang: ContentLang;
  readonly citedArticles: CitedArticle[];
}

const MAX_ARTICLES = 3;

export async function forTicket(ticketId: number, requestedBy: number): Promise<ReplyDraft> {
  // Same visibility path as the ticket detail endpoint, so an invisible ticket
  // refuses identically (404, never 403).
  await ticketService.getById(ticketId);

  const ticket = (await Ticket.findByPk(ticketId)) as Ticket;

  const rows = await Message.findAll({
    where: { ticket_id: ticketId },
    order: [
      ['occurred_at', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const messages = rows.map((row) => ({
    direction: row.direction as 'inbound' | 'outbound',
    body: row.body,
  }));

  const contentLang = conversationLang(messages);

  // Retrieval is best-effort: a draft grounded only in the conversation is
  // still useful, and a KB outage must not remove the feature.
  let hits: searchService.SearchHit[];

  try {
    const found = await searchService.search({
      query: `${ticket.subject ?? ''} ${ticket.description ?? ''}`.trim(),
      lang: contentLang,
      audience: 'internal',
      limit: MAX_ARTICLES,
    });

    hits = found.items;
  } catch {
    hits = [];
  }

  const result = await invoke(
    externalProviderFor(),
    {
      feature: 'draft',
      system: prompt.system(contentLang),
      messages: prompt.messages({
        subject: ticket.subject,
        messages,
        articles: hits.map((hit) => ({
          id: hit.articleId,
          title: hit.title,
          excerpt: hit.excerpt,
        })),
        agentName: '',
      }),
      maxOutput: 1024,
      contentLang,
    },
    { subjectType: 'ticket', subjectId: ticketId, requestedBy },
  );

  /**
   * CITATIONS ARE THE INTERSECTION of what the model referenced and what
   * retrieval actually supplied (FR-029, SC-007).
   *
   * Built by starting from `hits` and keeping the ones the draft mentions, so a
   * fabricated reference has nowhere to enter: an id the model invented is not
   * in `hits`, so it cannot survive the filter and cannot reach the agent. This
   * is why the ids are markers in the prompt rather than something the model is
   * asked to reproduce from memory.
   *
   * An empty list is a normal outcome — it means the draft was written from the
   * conversation alone, which is the right answer for most tickets.
   */
  const referenced = new Set(
    [...result.text.matchAll(/\[article (\d+)\]/g)].map((match) => Number(match[1])),
  );

  const citedArticles = hits
    .filter((hit) => referenced.has(hit.articleId))
    .map((hit) => ({ id: hit.articleId, slug: hit.slug, title: hit.title }));

  return {
    // The article markers are scaffolding for the model, not text for a
    // customer: they are stripped before the draft reaches the composer.
    text: result.text.replace(/\[article \d+\]/g, '').trim(),
    contentLang,
    citedArticles,
  };
}
