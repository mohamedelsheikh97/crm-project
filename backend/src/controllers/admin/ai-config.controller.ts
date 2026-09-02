import type { NextFunction, Request, Response } from 'express';

import { AI_FEATURES } from '../../ai/features.js';
import { AiInvocation } from '../../models/ai-invocation.model.js';
import { AssistantConversation } from '../../models/assistant-conversation.model.js';
import { AssistantMessage } from '../../models/assistant-message.model.js';
import { unauthenticated } from '../../errors/app-error.js';
import * as configService from '../../services/ai-config.service.js';
import { auditContextFrom } from '../../services/audit.service.js';

/**
 * AI administration (Phase 9, US6, FR-060 - FR-064).
 *
 * NOTHING HERE RETURNS A SECRET (FR-064). No API key, no base URL, no model id.
 * And deliberately NO PROCESSING LOCATION: it is not configurable (research
 * D2), and returning it read-only would invite a PATCH for it later. The
 * response describes POLICY, not credentials and not topology.
 */
function actorFrom(req: Request) {
  if (!req.user) throw unauthenticated();
  return { id: req.user.id, email: req.user.email };
}

export async function get(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await configService.current());
  } catch (error) {
    next(error);
  }
}

export async function patch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const updated = await configService.update(
      req.body ?? {},
      actorFrom(req),
      auditContextFrom(req),
    );

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

/**
 * What ran, on what, when, at whose request (FR-063).
 *
 * METADATA ONLY, because that is all there is — see the `ai_invocations`
 * migration. The interface says so on screen, so a reader looking for "what did
 * it actually say" learns why they cannot see it rather than assuming a bug.
 */
export async function activity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    const where = AI_FEATURES.includes(req.query.feature as never)
      ? { feature: req.query.feature as string }
      : {};

    const { rows, count } = await AiInvocation.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.status(200).json({
      items: rows.map((row) => ({
        id: row.id,
        feature: row.feature,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        requestedBy: row.requested_by,
        portalAccountId: row.portal_account_id,
        location: row.location,
        outcome: row.outcome,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        durationMs: row.duration_ms,
        errorCode: row.error_code,
        at: row.created_at,
      })),
      page,
      pageSize,
      total: count,
      /** Stated in the payload so a client cannot present this as a content log. */
      contentRetained: false,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Chatbot transcripts (FR-043).
 *
 * The exception to metadata-only, and the reason is FR-065a: a conversation is
 * retained because it is what the organisation SAID TO A CUSTOMER, on the same
 * basis Phase 5 retains outbound messages — not because AI produced it.
 */
export async function conversations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    const { rows, count } = await AssistantConversation.findAndCountAll({
      order: [['id', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.status(200).json({
      items: rows.map((row) => ({
        id: row.id,
        portalAccountId: row.portal_account_id,
        anonymous: row.portal_account_id === null,
        lang: row.lang,
        ticketId: row.ticket_id,
        escalatedAt: row.escalated_at,
        lastActivityAt: row.last_activity_at,
      })),
      page,
      pageSize,
      total: count,
    });
  } catch (error) {
    next(error);
  }
}

export async function conversation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const found = await AssistantConversation.findByPk(id);

    if (!found) {
      res.status(404).json({ error: { code: 'not_found', message: 'not_found', details: [] } });
      return;
    }

    const turns = await AssistantMessage.findAll({
      where: { conversation_id: id },
      order: [['id', 'ASC']],
    });

    res.status(200).json({
      id: found.id,
      lang: found.lang,
      ticketId: found.ticket_id,
      escalatedAt: found.escalated_at,
      turns: turns.map((turn) => ({
        role: turn.role,
        body: turn.body,
        citedArticleIds: turn.cited_article_ids,
        at: turn.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
}
