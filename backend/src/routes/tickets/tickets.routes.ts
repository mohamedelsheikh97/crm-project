import { Router } from 'express';

import * as dashboardController from '../../controllers/dashboard/dashboard.controller.js';
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
// Phase 8 (FR-026h, FR-057a). Records which contact raised an existing ticket,
// which is what makes it visible in that person's portal.
//
// GATED ON portal:manage, NOT tickets:update. This is not an edit to the ticket's
// content — it is a decision to disclose a conversation to somebody outside the
// organisation, and it is audited as one
// (`portal.ticket.contact_associated`). An agent who may correct a subject line
// is not thereby somebody who may decide who reads the thread.
router.patch(
  '/:id/requesting-contact',
  requirePermission('portal:manage'),
  ticketsController.setRequestingContact,
);

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

// Phase 4. Its OWN permission, not tickets:update: reading a queue must never
// imply the authority to change what is late (FR-075). PUT because the whole
// value is replaced and a null `dueAt` is a deliberate clear (FR-026).
router.put(
  '/:id/due-date',
  requirePermission('tickets:set_due_date'),
  ticketsController.setDueDate,
);

// The customer context panel: ONE call for the whole panel, because three
// round-trips would make "without navigating away" feel like navigating away.
// Requires customers:view IN ADDITION to the group's authentication; a caller
// without it gets no panel and loses no ticket action (FR-018).
router.get(
  '/:id/context',
  requirePermission('customers:view'),
  dashboardController.customerContext,
);

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
