import { Router } from 'express';

import { AI_SCOPES, AI_STAFF_PER_MINUTE, byUser } from '../../ai/rate-limits.js';
import * as draftController from '../../controllers/ai/draft.controller.js';
import * as proposalController from '../../controllers/ai/proposal.controller.js';
import * as similarController from '../../controllers/ai/similar.controller.js';
import * as summaryController from '../../controllers/ai/summary.controller.js';
import { rateLimitKeyed } from '../../lib/rate-limit.js';
import { requirePermission } from '../../middleware/require-permission.js';

/**
 * Ticket-scoped AI endpoints (Phase 9).
 *
 * Mounted INSIDE the tickets router, which applies `authenticate` and
 * `requirePasswordChange` once for that group — the same way `ticketNotesRoutes`
 * and `messageRoutes` already are. Doing it this way means this file cannot
 * accidentally gate anything outside the tickets surface, which is exactly what
 * the first version of the AI router did (see `routes/ai/index.ts`).
 *
 * Every route is gated on the authority for the UNDERLYING action (FR-061),
 * never on a permission of its own: summarising requires `tickets:view`,
 * drafting requires `messages:send`, accepting a category proposal requires
 * `tickets:update`.
 *
 * KEYED BY USER, NOT BY ADDRESS (research D11): a support team behind one
 * office address is many people, and IP-keying would let one of them exhaust
 * the allowance for the rest — Phase 8's D11 reasoning, applied to staff.
 */
const router = Router();

router.get(
  '/:id/ai/summary',
  requirePermission('tickets:view'),
  rateLimitKeyed(AI_SCOPES.SUMMARY, AI_STAFF_PER_MINUTE, byUser),
  summaryController.get,
);

// Drafting requires the authority to SEND (FR-028). Phase 5 split
// `messages:send` from `ticket_notes:create` because writing to a colleague and
// speaking to a customer in the organisation's name are different powers; a
// draft is the second one, one keystroke early.
router.post(
  '/:id/ai/draft',
  requirePermission('messages:send'),
  rateLimitKeyed(AI_SCOPES.DRAFT, AI_STAFF_PER_MINUTE, byUser),
  draftController.create,
);

// Retrieval, not generation: no rate-limit scope and no ceiling, because it
// makes no model call and costs one query (research D8).
router.get('/:id/similar', requirePermission('tickets:view'), similarController.list);

// Reading a proposal needs only ticket visibility; ACCEPTING one needs
// `tickets:update` — the authority to set a category, unchanged. That split is
// the point: the proposal is advice, and acting on it is the same act it
// always was.
router.get('/:id/ai/category-proposal', requirePermission('tickets:view'), proposalController.get);
router.post(
  '/:id/ai/category-proposal/accept',
  requirePermission('tickets:update'),
  rateLimitKeyed(AI_SCOPES.CLASSIFY, AI_STAFF_PER_MINUTE, byUser),
  proposalController.accept,
);
router.post('/:id/ai/category-proposal/dismiss', requirePermission('tickets:update'), proposalController.dismiss);

export default router;
