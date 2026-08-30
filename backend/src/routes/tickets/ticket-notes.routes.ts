import { Router } from 'express';

import * as ticketNotesController from '../../controllers/tickets/ticket-notes.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Reading a ticket's notes needs only tickets:view — anyone who may read the
// ticket may read the conversation on it. Writing is its own grant.
router.get('/:id/notes', requirePermission('tickets:view'), ticketNotesController.list);
router.post('/:id/notes', requirePermission('ticket_notes:create'), ticketNotesController.create);

// The route gate is ticket_notes:create, which is what an author needs to edit
// their OWN note. The service additionally demands ticket_notes:manage when the
// note belongs to someone else (FR-034) — a condition a route gate cannot
// express, which is why the permission matrix defers to notes.test.ts here.
router.patch(
  '/:id/notes/:noteId',
  requirePermission('ticket_notes:create'),
  ticketNotesController.update,
);

// There is deliberately NO delete route. A note is part of the record.

// Feeds the mention picker. tickets:view, because it reveals nothing the
// ticket screen does not already show.
router.get(
  '/:id/mentionable-users',
  requirePermission('tickets:view'),
  ticketNotesController.mentionable,
);

export default router;
