import { Router } from 'express';

import * as auditController from '../../controllers/admin/audit.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Only administrative readers (FR-038). There is deliberately no POST, PATCH,
// PUT, or DELETE at any path under this resource (FR-035).
router.get('/', requirePermission('audit:view'), auditController.list);
router.get('/actions', requirePermission('audit:view'), auditController.actions);

export default router;
