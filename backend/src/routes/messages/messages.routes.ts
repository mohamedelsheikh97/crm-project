import { Router } from 'express';

import * as messagesController from '../../controllers/messages/messages.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Reading correspondence needs only tickets:view — anyone who may read the
// ticket may read the conversation on it. The same rule Phase 4 applied to
// notes, and the reason there is no separate "read messages" permission.
router.get('/:id/messages', requirePermission('tickets:view'), messagesController.list);

// What the composer needs BEFORE the agent types: channel, recipient, opt-out,
// and reply window (FR-051, FR-057). tickets:view, because it reveals nothing
// the ticket screen does not already show.
router.get('/:id/messages/context', requirePermission('tickets:view'), messagesController.context);

// Speaking to a customer in the organisation's name. Deliberately NOT
// ticket_notes:create: the two composers on one screen require two grants, and
// that separation is the whole of SC-006.
router.post('/:id/messages', requirePermission('messages:send'), messagesController.send);

// Moving a conversation to the right customer (FR-017). Supervisory, because it
// moves correspondence between records.
router.post(
  '/:id/reattribute',
  requirePermission('messages:reattribute'),
  messagesController.reattribute,
);

// There is deliberately NO edit and NO delete route. What was said to a
// customer is part of the record, and the customer has their own copy.

export default router;
