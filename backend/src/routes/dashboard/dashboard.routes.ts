import { Router } from 'express';

import * as dashboardController from '../../controllers/dashboard/dashboard.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Delegation only. Every route carries a requirePermission — the matrix test
// fails any that does not.

// The route gate is dashboard:view, which covers YOUR OWN queue. Asking for
// someone else's with ?userId= is additionally gated on dashboard:view_any in
// the service, because a route gate cannot express "allowed for your own,
// refused for another's" (FR-010).
router.get('/queue', requirePermission('dashboard:view'), dashboardController.queue);

export default router;
