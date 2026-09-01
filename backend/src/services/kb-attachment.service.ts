import { KbArticle, KbTicketArticle, Ticket } from '../models/index.js';
import { notFound } from '../errors/app-error.js';

/**
 * Pinning an article to a ticket (Phase 7, User Story 7).
 *
 * THIS IS NOT WHERE SUGGESTIONS LIVE, and the distinction is FR-042. A
 * suggestion is computed on read and never stored — it goes stale the moment an
 * article is archived. An attachment is a DECISION somebody made: an agent
 * saying "this is the answer", or a rule saying it on their behalf. Those are
 * different facts about the world, and collapsing them would make a week-old
 * guess indistinguishable from a colleague's judgement.
 *
 * ONE SERVICE, TWO CALLERS. The attach endpoint and the automation executor
 * both come through here, so an agent pinning an article and a rule pinning one
 * go through exactly the same checks. Phase 6 fixed that rule when its engine
 * went through services rather than models: a second enforcement path is a
 * second place for the rules to drift.
 */

export interface AttachOutcome {
  attached: boolean;
  /** An i18n key describing WHY, never a sentence (FR-047). */
  refusal: string | null;
}

/**
 * Attach, or explain why not.
 *
 * `attachedByUserId` NULL MEANS AN AUTOMATION RULE DID IT.
 *
 * Returns an outcome rather than throwing, because the automation executor
 * needs to RECORD a failure rather than abort a run — one action failing must
 * not discard the others the rule performed. The controller turns the same
 * outcome into an HTTP status.
 */
export async function attach(
  ticketId: number,
  articleId: number,
  attachedByUserId: number | null,
): Promise<AttachOutcome> {
  if (!Number.isInteger(articleId) || articleId < 1) {
    return { attached: false, refusal: 'kb.attach.error.articleUnknown' };
  }

  const ticket = await Ticket.findByPk(ticketId);

  if (!ticket) return { attached: false, refusal: 'kb.attach.error.ticketUnknown' };

  const article = await KbArticle.findByPk(articleId);

  // FR-047's case, stated plainly. A rule that names an article somebody
  // archived last month must fail LOUDLY: the article was archived because it
  // was wrong, and pinning it anyway would put the wrong answer in front of an
  // agent with a rule's authority behind it.
  if (!article) return { attached: false, refusal: 'kb.attach.error.articleUnknown' };

  if (article.status !== 'published') {
    return { attached: false, refusal: 'kb.attach.error.articleNotPublished' };
  }

  // A DOUBLE-CLICK IS NOT AN ERROR WORTH REFUSING. Attaching the same article
  // twice is a no-op, guaranteed by the composite primary key rather than by
  // this check — the check exists so the caller learns nothing changed, not so
  // the database stays consistent.
  const [, created] = await KbTicketArticle.findOrCreate({
    where: { ticket_id: ticketId, article_id: articleId },
    defaults: {
      ticket_id: ticketId,
      article_id: articleId,
      attached_by_user_id: attachedByUserId,
    },
  });

  // `created` false means it was already there. Still a success: the world is
  // in the state the caller asked for.
  return { attached: true, refusal: created ? null : null };
}

/**
 * Unpin.
 *
 * Removing an attachment removes an OPINION about the ticket, and touches
 * neither the article nor the ticket. There is nothing to preserve here the way
 * there is for an article, which is why this is a real delete and not an
 * archive: nobody sent anybody a link to an attachment.
 */
export async function detach(ticketId: number, articleId: number): Promise<void> {
  const removed = await KbTicketArticle.destroy({
    where: { ticket_id: ticketId, article_id: articleId },
  });

  // Removing something that is not there is a 404 rather than a silent success,
  // so an agent whose click did nothing finds out.
  if (removed === 0) throw notFound();
}

/** What is pinned to a ticket, oldest first — the order they were decided in. */
export async function listForTicket(ticketId: number): Promise<KbTicketArticle[]> {
  return KbTicketArticle.findAll({
    where: { ticket_id: ticketId },
    include: [{ association: 'article' }, { association: 'attachedBy' }],
    order: [['created_at', 'ASC']],
  });
}
