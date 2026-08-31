import { Router } from 'express';

import * as timelineController from '../../controllers/timeline/timeline.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// customers:view, with NO separate timeline key. A permission every role holds
// unconditionally cannot refuse anything — the same reasoning that kept
// `notifications:view` out of the Phase 4 catalog. What actually narrows this
// view is ticket visibility, applied in the service (FR-090).
router.get('/:id/timeline', requirePermission('customers:view'), timelineController.forCustomer);

export default router;
