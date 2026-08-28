import { UniqueConstraintError } from 'sequelize';

import { sequelize } from '../config/database.js';
import { notFound, validationError } from '../errors/app-error.js';
import { Ticket, TicketLink } from '../models/index.js';
import { normalisePair } from '../models/ticket-link.model.js';
import { toReference } from '../tickets/reference.js';

import * as auditService from './audit.service.js';
import * as historyService from './ticket-history.service.js';
import * as lifecycleService from './ticket-lifecycle.service.js';
import type { Actor, AuditContext } from './ticket.service.js';

/**
 * Linking relates two tickets without either losing its identity (FR-047) —
 * which is the whole difference from merging. Unlinking leaves both otherwise
 * untouched (FR-049).
 */

async function loadWorkable(id: number): Promise<Ticket> {
  const ticket = await Ticket.findByPk(id);

  if (!ticket) throw notFound();

  await lifecycleService.assertWorkable(ticket);

  return ticket;
}

export async function create(
  ticketId: number,
  linkedTicketIdInput: unknown,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const linkedId = Number(linkedTicketIdInput);

  if (!Number.isInteger(linkedId) || linkedId < 1) {
    throw validationError([
      { field: 'linkedTicketId', message: 'ticket.error.linkTargetRequired' },
    ]);
  }

  if (linkedId === ticketId) {
    throw validationError([{ field: 'linkedTicketId', message: 'ticket.error.linkSelf' }]);
  }

  const ticket = await loadWorkable(ticketId);
  const other = await loadWorkable(linkedId);

  // Normalised on write, so the UNIQUE index alone prevents a duplicate in
  // EITHER direction (FR-048). There is no application-level duplicate check
  // here, and deliberately so — one that could be forgotten is worse than none.
  const pair = normalisePair(ticket.id, other.id);

  try {
    await sequelize.transaction(async (transaction) => {
      await TicketLink.create(
        {
          ticket_id: pair.ticketId,
          linked_ticket_id: pair.linkedTicketId,
          created_by_user_id: actor.id,
        },
        { transaction },
      );

      // Recorded on both timelines: a link is a fact about each ticket, and a
      // reader of either one should see it without opening the other.
      await historyService.record(
        {
          ticketId: ticket.id,
          event: historyService.TICKET_EVENTS.LINKED,
          actor,
          field: 'link',
          newValue: toReference(other.id),
        },
        transaction,
      );

      await historyService.record(
        {
          ticketId: other.id,
          event: historyService.TICKET_EVENTS.LINKED,
          actor,
          field: 'link',
          newValue: toReference(ticket.id),
        },
        transaction,
      );

      await auditService.record(
        {
          action: auditService.AUDIT_ACTIONS.TICKET_LINKED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'ticket',
          targetId: ticket.id,
          targetLabel: toReference(ticket.id),
          newValue: { linkedTicketId: other.id },
          ...context,
        },
        transaction,
      );
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw validationError([{ field: 'linkedTicketId', message: 'ticket.error.linkDuplicate' }]);
    }

    throw error;
  }
}

export async function remove(
  ticketId: number,
  linkedTicketId: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const ticket = await loadWorkable(ticketId);
  const other = await Ticket.findByPk(linkedTicketId);

  if (!other) throw notFound();

  const pair = normalisePair(ticket.id, other.id);

  const link = await TicketLink.findOne({
    where: { ticket_id: pair.ticketId, linked_ticket_id: pair.linkedTicketId },
  });

  if (!link) throw notFound();

  await sequelize.transaction(async (transaction) => {
    await link.destroy({ transaction });

    await historyService.record(
      {
        ticketId: ticket.id,
        event: historyService.TICKET_EVENTS.UNLINKED,
        actor,
        field: 'link',
        previousValue: toReference(other.id),
      },
      transaction,
    );

    await historyService.record(
      {
        ticketId: other.id,
        event: historyService.TICKET_EVENTS.UNLINKED,
        actor,
        field: 'link',
        previousValue: toReference(ticket.id),
      },
      transaction,
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.TICKET_UNLINKED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: toReference(ticket.id),
        previousValue: { linkedTicketId: other.id },
        ...context,
      },
      transaction,
    );
  });

  // Neither ticket is otherwise affected (FR-049). Nothing above touches a
  // status, an assignee, or a version — which is the implementation of that
  // requirement, and the difference between a link and a merge.
}
