import { Router } from 'express';

import * as notificationsController from '../../controllers/notifications/notifications.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Delegation only. Every route carries a requirePermission — the matrix test
// fails any that does not.
//
// The gate is `dashboard:view` throughout, and there is deliberately no
// `notifications:view` key: a permission every role holds unconditionally can
// never refuse anything, so it would be noise on the roles screen and a matrix
// row that cannot fail (research D6). The real control here is OWNERSHIP,
// enforced in the service and verified by tests/ownership.matrix.test.ts.

// The stream is declared before '/:id/...' so 'stream' is never parsed as an id.
router.get('/stream', requirePermission('dashboard:view'), notificationsController.stream);

router.get('/', requirePermission('dashboard:view'), notificationsController.list);
router.post('/read-all', requirePermission('dashboard:view'), notificationsController.markAllRead);
router.post('/:id/read', requirePermission('dashboard:view'), notificationsController.markRead);

// There is deliberately NO delete route. A notification is read, not deleted;
// the list is bounded by paging instead (FR-050).

export default router;
