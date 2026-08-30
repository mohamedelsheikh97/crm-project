import { Router } from 'express';

import * as tasksController from '../../controllers/tasks/tasks.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Delegation only. Every route carries a requirePermission — the matrix test
// fails any that does not.
//
// The permission is necessary but not sufficient: every route is additionally
// scoped to the OWNER in the service, because two agents hold identical
// permissions and still must not see each other's commitments (FR-076).

// Reading your own list is part of having a dashboard; creating and changing
// tasks is its own grant.
router.get('/', requirePermission('dashboard:view'), tasksController.list);

router.post('/', requirePermission('tasks:manage'), tasksController.create);
router.patch('/:id', requirePermission('tasks:manage'), tasksController.update);
router.post('/:id/complete', requirePermission('tasks:manage'), tasksController.complete);
router.post('/:id/reopen', requirePermission('tasks:manage'), tasksController.reopen);

// There is deliberately NO delete route, and no owner field on any payload:
// tasks are personal and completed rather than discarded (Clarifications Q3).

export default router;
