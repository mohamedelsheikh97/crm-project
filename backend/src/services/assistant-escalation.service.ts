import { AUDIT_ACTIONS, record as recordAudit } from './audit.service.js';
import { AssistantConversation } from '../models/assistant-conversation.model.js';
import { AssistantMessage } from '../models/assistant-message.model.js';
import { PortalAccount } from '../models/portal-account.model.js';
import { Ticket } from '../models/ticket.model.js';
import { CustomerContact } from '../models/customer-contact.model.js';
import { sequelize } from '../config/database.js';
import { toReference } from '../tickets/reference.js';

/**
 * Handing a conversation to a person (Phase 9, US3, FR-036 - FR-036c).
 *
 * IDEMPOTENT BY CONSTRUCTION, not by a check. `assistant_conversations` has a
 * UNIQUE on `ticket_id`, so a second escalation is a duplicate-key violation
 * that this service translates into "already escalated" and answers with the
 * existing reference. A check-then-insert would pass every test and still
 * create two tickets when a customer double-taps — which is exactly the case
 * FR-036c exists to prevent, and exactly the pattern Phase 8's satisfaction
 * service rejected for the same reason.
 *
 * THE CONVERSATION TRAVELS WITH THE TICKET (FR-036a) so nobody has to repeat
 * themselves, and it is MARKED as assistant dialogue (FR-036b) so the boundary
 * between what a machine said and what a person says is legible on the ticket.
 */
export class AlreadyEscalatedError extends Error {
  constructor(readonly ticketReference: string) {
    super('already escalated');
    this.name = 'AlreadyEscalatedError';
  }
}

export interface EscalationResult {
  readonly ticketReference: string;
}

const HEADER: Readonly<Record<'ar' | 'en', string>> = {
  en: '--- Conversation with the automated assistant ---',
  ar: '--- محادثة مع المساعد الآلي ---',
};

const FOOTER: Readonly<Record<'ar' | 'en', string>> = {
  en: '--- The assistant could not resolve this and passed it to a colleague ---',
  ar: '--- لم يتمكن المساعد من حل هذا وحوّله إلى أحد الزملاء ---',
};

export async function escalate(conversationId: number): Promise<EscalationResult> {
  const conversation = await AssistantConversation.findByPk(conversationId);

  if (!conversation) throw new Error('conversation not found');

  // Fast path for the common repeat: the customer kept typing after
  // escalating. Not the control — the UNIQUE index is — but it saves building
  // a ticket only to discard it.
  if (conversation.ticket_id) {
    throw new AlreadyEscalatedError(toReference(conversation.ticket_id));
  }

  const account = conversation.portal_account_id
    ? await PortalAccount.findByPk(conversation.portal_account_id)
    : null;

  const contact = account
    ? await CustomerContact.findByPk(account.customer_contact_id)
    : null;

  if (!contact) {
    // An anonymous conversation has no customer record to attribute to. The
    // public route collects an email first and resolves identity through the
    // Phase 5 intake path; reaching here without one is a caller error.
    throw new Error('escalation requires an identified contact');
  }

  const turns = await AssistantMessage.findAll({
    where: { conversation_id: conversationId },
    order: [['id', 'ASC']],
  });

  const lang = conversation.lang;

  const description = [
    HEADER[lang],
    '',
    ...turns.map((turn) => `${turn.role === 'customer' ? 'Customer' : 'Assistant'}: ${turn.body}`),
    '',
    FOOTER[lang],
  ].join('\n');

  const subject = firstQuestion(turns) ?? 'Assistant escalation';

  try {
    return await sequelize.transaction(async (transaction) => {
      const ticket = await Ticket.create(
        {
          customer_id: contact.customer_id,
          subject: subject.slice(0, 200),
          description,
          // The DEFAULT category. Classification does not run on this ticket and
          // could not set one anyway (Clarifications Q2).
          category: 'general',
          priority: 'normal',
          status: 'new',
          source: 'portal',
          requesting_contact_id: contact.id,
          assistant_conversation_id: conversationId,
        } as never,
        { transaction },
      );

      const ticketId = (ticket as unknown as { id: number }).id;

      // The write that can violate the UNIQUE. Anything concurrent loses here.
      await conversation.update(
        { ticket_id: ticketId, escalated_at: new Date(), last_activity_at: new Date() },
        { transaction },
      );

      await recordAudit(
        {
          action: AUDIT_ACTIONS.AI_ASSISTANT_ESCALATED,
          targetType: 'ticket',
          targetId: ticketId,
          actorUserId: null,
          targetLabel: contact.value_raw,
        },
        transaction,
      );

      return { ticketReference: toReference(ticketId) };
    });
  } catch (error) {
    // The concurrent loser lands here. Re-read and answer with the reference the
    // winner created, so the customer sees one ticket and one number.
    const reread = await AssistantConversation.findByPk(conversationId);

    if (reread?.ticket_id) {
      throw new AlreadyEscalatedError(toReference(reread.ticket_id));
    }

    throw error;
  }
}

/** The customer's first message makes a better subject than a generic label. */
function firstQuestion(turns: AssistantMessage[]): string | null {
  const first = turns.find((turn) => turn.role === 'customer');
  if (!first) return null;

  const [line] = first.body.split('\n');
  return (line ?? '').trim() || null;
}
