import { Router } from 'express';

import * as attachmentsController from '../../controllers/knowledge/attachments.controller.js';
import * as suggestionsController from '../../controllers/knowledge/suggestions.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

/**
 * Knowledge hanging off a TICKET.
 *
 * Mounted under the ticket router rather than the knowledge one, because these
 * are questions about a ticket — "what might answer this?" — not questions
 * about the knowledge base. That also means they inherit the ticket router's
 * authentication in one place, which is the pattern Phase 5 established for
 * message routes.
 *
 * `tickets:view` gates suggestion, not a knowledge key: if you can open the
 * ticket, you can see what might answer it.
 */
router.get('/:id/suggestions', requirePermission('tickets:view'), suggestionsController.forTicket);

// Pinning is a change to the TICKET's working context, so `tickets:update`
// rather than a knowledge key: an agent who may work the ticket may say which
// article answers it, and saying so changes nothing about the article.
router.post('/:id/articles', requirePermission('tickets:update'), attachmentsController.attach);
router.delete(
  '/:id/articles/:articleId',
  requirePermission('tickets:update'),
  attachmentsController.detach,
);

export default router;
