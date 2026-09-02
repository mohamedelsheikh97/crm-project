import type { NextFunction, Request, Response } from 'express';

import { conflict, unauthenticated } from '../../errors/app-error.js';
import { AiCategoryProposal } from '../../models/ai-category-proposal.model.js';
import { Ticket } from '../../models/ticket.model.js';
import {
  AUDIT_ACTIONS,
  auditContextFrom,
  record as recordAudit,
} from '../../services/audit.service.js';
import * as classifyService from '../../services/ai-classify.service.js';
import * as ticketService from '../../services/ticket.service.js';
import { sequelize } from '../../config/database.js';

/**
 * Category proposals (Phase 9, US4, Clarifications Q2).
 *
 * `accept` IS THE ONLY ENDPOINT IN THIS PHASE THAT CHANGES A TICKET FIELD, and
 * a human invoked it. That sentence is the whole of Clarifications Q2.
 */
function ticketId(req: Request): number {
  return Number(req.params.id);
}

function actorFrom(req: Request) {
  if (!req.user) throw unauthenticated();

  return {
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    roleId: req.user.roleId,
  };
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Visibility by the same path as the ticket detail endpoint: 404, never 403.
    await ticketService.getById(ticketId(req));

    res.status(200).json({ proposal: await classifyService.pendingFor(ticketId(req)) });
  } catch (error) {
    next(error);
  }
}

export async function accept(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    const id = ticketId(req);
    const detail = await ticketService.getById(id);

    const proposal = await AiCategoryProposal.findOne({
      where: { ticket_id: id, state: 'pending' },
    });

    if (!proposal) {
      next(conflict('proposal_not_pending'));
      return;
    }

    const ticket = (await Ticket.findByPk(id)) as Ticket;

    // FR-049 again, at the write. Between the banner rendering and this click a
    // colleague may have categorised the ticket; accepting would then overwrite
    // a human decision with a machine's suggestion, which is the one thing this
    // whole design exists to prevent.
    if (ticket.category !== proposal.category_at_proposal) {
      next(conflict('proposal_not_pending'));
      return;
    }

    /**
     * THROUGH THE PHASE 3 UPDATE PATH, deliberately (FR-045a).
     *
     * Not `Ticket.update` and not a bespoke write. Going through the service
     * means the optimistic-locking version check, the ticket history row, the
     * audit entry, and any Phase 6 side effects all happen exactly as they do
     * when a person types the category — because that is what this is. A direct
     * write here would produce a category change with no history and no
     * attributable actor, which is the shape of the bug FR-045b forbids.
     */
    const updated = await ticketService.update(
      id,
      { category: proposal.proposed, version: detail.version },
      actorFrom(req),
      auditContextFrom(req),
    );

    await sequelize.transaction(async (transaction) => {
      await proposal.update(
        { state: 'accepted', resolved_by: req.user!.id, resolved_at: new Date() },
        { transaction },
      );

      await recordAudit(
        {
          action: AUDIT_ACTIONS.AI_CATEGORY_ACCEPTED,
          targetType: 'ticket',
          targetId: id,
          actorUserId: req.user!.id,
          actorEmail: req.user!.email,
          newValue: { category: proposal.proposed },
          metadata: { proposalId: proposal.id },
          ...auditContextFrom(req),
        },
        transaction,
      );
    });

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

export async function dismiss(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    const id = ticketId(req);
    await ticketService.getById(id);

    const proposal = await AiCategoryProposal.findOne({
      where: { ticket_id: id, state: 'pending' },
    });

    if (!proposal) {
      next(conflict('proposal_not_pending'));
      return;
    }

    await sequelize.transaction(async (transaction) => {
      // Terminal. `UNIQUE(ticket_id)` means no second proposal can be inserted,
      // so dismissal is permanent for this ticket without needing a flag to say
      // so (FR-047).
      await proposal.update(
        { state: 'dismissed', resolved_by: req.user!.id, resolved_at: new Date() },
        { transaction },
      );

      await recordAudit(
        {
          action: AUDIT_ACTIONS.AI_CATEGORY_DISMISSED,
          targetType: 'ticket',
          targetId: id,
          actorUserId: req.user!.id,
          actorEmail: req.user!.email,
          metadata: { proposalId: proposal.id, proposed: proposal.proposed },
          ...auditContextFrom(req),
        },
        transaction,
      );
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
