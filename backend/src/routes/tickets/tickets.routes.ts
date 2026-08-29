import { Router } from 'express';

import * as ticketsController from '../../controllers/tickets/tickets.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Delegation only. Every route carries a requirePermission — the matrix test
// fails any that does not.

router.get('/', requirePermission('tickets:view'), ticketsController.list);
router.post('/', requirePermission('tickets:create'), ticketsController.create);

router.get('/:id', requirePermission('tickets:view'), ticketsController.get);
router.patch('/:id', requirePermission('tickets:update'), ticketsController.update);

// Discovery and the move itself. The interface renders its buttons from the
// GET and holds no copy of the lifecycle table.
router.get('/:id/transitions', requirePermission('tickets:view'), ticketsController.transitions);

// ONE endpoint for every lifecycle move. The route gate is tickets:transition;
// the edge's own permission — tickets:close, tickets:reopen — is enforced by
// the lifecycle service, because a route gate cannot express "this edge needs
// more than that edge".
router.post(
  '/:id/transitions',
  requirePermission('tickets:transition'),
  ticketsController.transition,
);

// Supervisor-only (Clarifications Q3). There is deliberately no claim route: an
// Agent cannot assign a ticket to anyone, including themselves.
router.put('/:id/assignee', requirePermission('tickets:assign'), ticketsController.assign);

// tickets:view, NOT audit:view. The per-ticket history is everyday working
// context; the audit log is administration (FR-037).
router.get('/:id/history', requirePermission('tickets:view'), ticketsController.history);
// There is NO write route for history at any path — it is append-only, and is
// appended to only as a side effect of a real change (FR-034).

router.post('/:id/merge', requirePermission('tickets:merge'), ticketsController.merge);

router.post('/:id/links', requirePermission('tickets:link'), ticketsController.link);
router.delete('/:id/links/:linkedId', requirePermission('tickets:link'), ticketsController.unlink);

// There is deliberately NO DELETE for a ticket at any path. A ticket is merged
// or closed, never deleted.

export default router;
