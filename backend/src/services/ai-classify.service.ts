import { invoke } from '../ai/invoke.js';
import * as prompt from '../ai/prompts/classify.js';
import { externalProviderFor } from '../ai/providers/external-factory.js';
import { AiCategoryProposal } from '../models/ai-category-proposal.model.js';
import { Message } from '../models/message.model.js';
import { Ticket } from '../models/ticket.model.js';
import type { TicketCategory } from '../tickets/taxonomy.js';

import { AUDIT_ACTIONS, record as recordAudit } from './audit.service.js';
import { sequelize } from '../config/database.js';

/**
 * Automatic categorisation — PROPOSING ONLY (Phase 9, US4, Clarifications Q2).
 *
 * THIS SERVICE NEVER WRITES `tickets.category`. Grep it: there is no
 * `Ticket.update` and no `ticket.set('category', …)` anywhere in this file, and
 * `backend/tests/ai/classify.test.ts` asserts that no classification path
 * touches the field. That absence is FR-045b, and it is what keeps Phase 6's
 * automation conditions and SLA policy selection reading only values a person
 * chose.
 *
 * Acceptance lives in `controllers/ai/proposal.controller.ts` and goes through
 * `ticket.service.update`, so the resulting audit entry and history record are
 * indistinguishable from a human typing the category — because that is what it
 * is (FR-045a).
 */

/**
 * Below this, no proposal is made (FR-048).
 *
 * A SECOND TUNABLE THRESHOLD, and worth flagging as such: like the assistant's
 * grounding floor, every test passes at either extreme. Too low and agents get
 * a banner on every ticket that is wrong a third of the time, which trains them
 * to dismiss it unread; too high and the feature never appears. SC-010's
 * acceptance rate is the number that tells you, and it needs real traffic.
 */
const MIN_CONFIDENCE = 0.6;

export interface ProposalView {
  readonly id: number;
  readonly proposed: TicketCategory;
  readonly confidence: number | null;
  readonly createdAt: Date;
}

/**
 * Classifies a ticket and records a proposal, or records nothing.
 *
 * NEVER THROWS TO ITS CALLER. It is invoked off the ticket-creation path
 * (FR-004) and a classification failure must not turn a successful intake into
 * an error — the ticket exists, it has its default category, and a human will
 * triage it exactly as they did before this phase.
 */
export async function proposeFor(ticketId: number): Promise<void> {
  try {
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) return;

    // FR-049: a human has already decided. Never propose against their choice,
    // and never as a correction to it.
    const existing = await AiCategoryProposal.findOne({ where: { ticket_id: ticketId } });
    if (existing) return;

    const first = await Message.findOne({
      where: { ticket_id: ticketId, direction: 'inbound' },
      order: [
        ['occurred_at', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const result = await invoke(
      externalProviderFor(),
      {
        feature: 'classify',
        system: prompt.system(),
        messages: prompt.messages({
          subject: ticket.subject,
          firstMessage: first?.body ?? ticket.description,
        }),
        // A category key and a number. Anything longer is the model ignoring
        // the instruction, and `parse` will reject it.
        maxOutput: 128,
        // The output is a fixed English key, not prose — see prompts/classify.ts
        // for why this one prompt is not bilingual.
        contentLang: 'en',
      },
      { subjectType: 'ticket', subjectId: ticketId, requestedBy: null },
    );

    const classification = prompt.parse(result.text);

    // No proposal rather than a weak one (FR-048). Unparseable, invented
    // category, and low confidence are all the same answer: we do not know.
    if (!classification || classification.confidence < MIN_CONFIDENCE) return;

    // Nothing to propose if it already holds that category.
    if (classification.category === ticket.category) return;

    await sequelize.transaction(async (transaction) => {
      // The UNIQUE on ticket_id is the guard. A concurrent insert loses here,
      // and losing is correct: one live proposal per ticket (FR-047).
      const proposal = await AiCategoryProposal.create(
        {
          ticket_id: ticketId,
          proposed: classification.category as TicketCategory,
          confidence: classification.confidence,
          category_at_proposal: ticket.category,
        },
        { transaction },
      );

      await recordAudit(
        {
          action: AUDIT_ACTIONS.AI_CATEGORY_PROPOSED,
          targetType: 'ticket',
          targetId: ticketId,
          actorUserId: null,
          newValue: { proposed: classification.category, confidence: classification.confidence },
          metadata: { proposalId: proposal.id },
        },
        transaction,
      );
    });
  } catch {
    // Swallowed deliberately, and the invocation record already holds the
    // failure (`invoke.ts` writes one for every outcome). A classification that
    // did not happen is invisible to the agent, which is the correct degradation
    // — the ticket keeps the category it had.
  }
}

/**
 * The pending proposal for a ticket, or null.
 *
 * SUPPRESSED WITHOUT A STATE CHANGE when the ticket's category has moved since
 * the proposal was made (FR-049). A human decided in the meantime, and the
 * proposal is stale advice about a ticket that has moved on — but it is not
 * `dismissed`, because nobody dismissed it, and SC-011's reporting should be
 * able to tell those apart.
 */
export async function pendingFor(ticketId: number): Promise<ProposalView | null> {
  const proposal = await AiCategoryProposal.findOne({
    where: { ticket_id: ticketId, state: 'pending' },
  });

  if (!proposal) return null;

  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) return null;

  if (ticket.category !== proposal.category_at_proposal) return null;

  return {
    id: proposal.id,
    proposed: proposal.proposed,
    confidence: proposal.confidence,
    createdAt: proposal.created_at,
  };
}
