import { KbCategory, KbTicketArticle, Ticket } from '../models/index.js';
import { normaliseQuery } from '../lib/text-normalise.js';
import * as searchService from './kb-search.service.js';

/**
 * Suggesting an article on a ticket (Phase 7, User Story 3).
 *
 * PLAN.md's Definition of done lives here: "the system proactively suggests one
 * on a matching ticket".
 *
 * IT IS `search`, WITH THE TICKET AS THE QUERY (research D5). Concatenate the
 * subject and description, normalise through the SAME tokenizer, rank with the
 * SAME function. That is why FR-043's Arabic requirement costs nothing: an
 * Arabic ticket is an Arabic query, and the matching was already built.
 *
 * NEVER STORED, ALWAYS RECOMPUTED (FR-042). A stored suggestion goes stale the
 * moment an article is archived, and nothing notices. `kb_ticket_articles`
 * holds only DELIBERATE attachments — an agent pinning one, or a rule acting —
 * which is a different fact about the world.
 */

/**
 * THE SCORE FLOOR. THE MOST IMPORTANT NUMBER IN THIS PHASE.
 *
 * WHAT IT COSTS TO GET WRONG, IN EACH DIRECTION:
 *
 *   TOO LOW  — the panel always shows three articles. Agents learn that the
 *              panel means nothing, stop reading it, and once they have stopped
 *              reading it, BETTER SUGGESTIONS CANNOT WIN THEM BACK. The feature
 *              is dead and looks alive.
 *   TOO HIGH — the panel is always empty. Agents learn the same lesson faster,
 *              but at least the failure is visible.
 *
 * AND BOTH PASS EVERY TEST IN THIS SUITE. A test can assert that a ticket
 * matching nothing produces nothing (T046 does) and that a ticket matching
 * something produces it (T045 does). Neither can tell you whether the ten
 * middling cases in between were worth showing. That needs real tickets and
 * somebody reading the results — which is why tasks.md carries T098 as a
 * separate, explicit tuning pass.
 *
 * THE STARTING RULE (contracts/search-contract.md): at least two matched query
 * terms, or one term strong enough to have matched a title. Expressed as a
 * score threshold, that is one title match (weight 10, one occurrence) with
 * something else, or two body terms in an article about the subject.
 */
export const MINIMUM_SCORE = 4;

/** Six is more than anybody reads beside a ticket they are already working. */
export const MAX_SUGGESTIONS = 5;

/**
 * How much a category match is worth (research D6).
 *
 * A BOOST, NEVER A FILTER. FR-040 says "prefer", and the difference matters: a
 * technical article can be the right answer to a billing ticket, and a filter
 * would make that answer unreachable. A multiplier lets the category tip a
 * close decision without ever overruling a clear one.
 */
export const CATEGORY_BOOST = 1.5;

export interface Suggestion extends searchService.SearchHit {
  /** True when this article was pinned rather than computed. */
  pinned: boolean;
  /** Null when an automation rule attached it (the Phase 5/6 convention). */
  attachedBy: { id: number; fullName: string } | null;
}

/**
 * Which language to suggest in.
 *
 * The ticket's own text decides, not the agent's interface. An Arabic ticket
 * should surface Arabic articles even when the agent happens to be working in
 * English, because the article has to answer the CUSTOMER — and the agent is
 * likely to paste from it.
 */
function languageOf(text: string): 'en' | 'ar' {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;

  return arabic > latin ? 'ar' : 'en';
}

/**
 * Articles whose category maps to the ticket's category (research D6).
 *
 * This is the whole of the KB-to-ticket relationship FR-040 requires, and it is
 * stated as data on `kb_categories.ticket_category` rather than inferred from
 * names — inferring would make "Billing" and "Billing enquiries" silently fail
 * to relate.
 */
async function boostsFor(ticketCategory: string | null): Promise<Map<number, number>> {
  if (!ticketCategory) return new Map();

  const categories = await KbCategory.findAll({ where: { ticket_category: ticketCategory } });

  return new Map(categories.map((category) => [category.id, CATEGORY_BOOST]));
}

export async function suggestForTicket(ticketId: number): Promise<Suggestion[]> {
  const ticket = await Ticket.findByPk(ticketId);

  if (!ticket) return [];

  // Pinned articles first, and separately: they are a DECISION somebody made,
  // not a guess this service is making. They are never subject to the floor.
  const pins = await KbTicketArticle.findAll({
    where: { ticket_id: ticketId },
    include: [
      { association: 'article', include: [{ association: 'category' }] },
      { association: 'attachedBy' },
    ],
    order: [['created_at', 'ASC']],
  });

  const query = `${ticket.subject ?? ''} ${ticket.description ?? ''}`.trim();
  const terms = normaliseQuery(query);

  const pinnedIds = pins.map((pin) => pin.article_id);
  const suggestions: Suggestion[] = [];

  for (const pin of pins) {
    const article = (pin as KbTicketArticle & { article?: PinnedArticle }).article;
    if (!article || article.status !== 'published') continue;

    /**
     * THE REPORTED LANGUAGE IS THE ONE ACTUALLY SERVED, not the one preferred.
     *
     * Preferring the ticket's language and then falling back to whatever the
     * article has is right; reporting the PREFERRED language after falling back
     * is not. That would hand an agent an English title labelled Arabic, with
     * `dir="rtl"` applied to it — which is exactly the mislabelling FR-005a
     * exists to prevent, and it looks like a rendering bug rather than a
     * one-language article.
     *
     * So the language and the title are decided together, from what exists.
     */
    const preferred = languageOf(query);
    const served: 'en' | 'ar' | null =
      preferred === 'ar' && article.title_ar
        ? 'ar'
        : preferred === 'en' && article.title_en
          ? 'en'
          : article.title_en
            ? 'en'
            : article.title_ar
              ? 'ar'
              : null;

    if (!served) continue;

    const title = served === 'ar' ? article.title_ar! : article.title_en!;

    const attachedBy = (pin as KbTicketArticle & { attachedBy?: { id: number; full_name: string } })
      .attachedBy;

    suggestions.push({
      articleId: article.id,
      slug: article.slug,
      title,
      lang: served,
      excerpt: '',
      categoryId: article.category_id,
      categoryName: article.category?.[served === 'ar' ? 'name_ar' : 'name_en'] ?? null,
      score: Number.POSITIVE_INFINITY,
      pinned: true,
      // NULL MEANS A RULE DID IT. The interface tells "a colleague pinned this"
      // from "a rule did", which are different things to the agent reading it.
      attachedBy: attachedBy ? { id: attachedBy.id, fullName: attachedBy.full_name } : null,
    });
  }

  // A ticket with a two-word subject and no description has nothing to search
  // with. Returning nothing is the honest answer.
  if (terms.length === 0) return suggestions;

  const result = await searchService.search({
    query,
    lang: languageOf(query),
    // An agent's surface. The public help centre never calls this.
    audience: 'internal',
    categoryBoosts: await boostsFor(ticket.category ?? null),
    exclude: pinnedIds,
    limit: MAX_SUGGESTIONS,
  });

  for (const hit of result.items) {
    /**
     * THE FLOOR, APPLIED HERE AND NOWHERE ELSE.
     *
     * A panel that is often empty and occasionally right is one agents read. A
     * panel that always shows three articles is one they learn to ignore, and
     * the learning is permanent.
     */
    if (hit.score < MINIMUM_SCORE) continue;
    if (suggestions.length >= MAX_SUGGESTIONS) break;

    suggestions.push({ ...hit, pinned: false, attachedBy: null });
  }

  return suggestions;
}

interface PinnedArticle {
  id: number;
  slug: string | null;
  title_en: string | null;
  title_ar: string | null;
  status: string;
  category_id: number;
  category?: { name_en: string | null; name_ar: string | null };
}
