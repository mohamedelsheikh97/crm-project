import { Router } from 'express';

import * as rolesController from '../../controllers/admin/roles.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

router.get('/roles', requirePermission('roles:view'), rolesController.list);
router.get('/permissions', requirePermission('roles:view'), rolesController.catalog);
router.put(
  '/roles/:id/permissions',
  requirePermission('roles:update_permissions'),
  rolesController.replacePermissions,
);

// Deliberately no POST or DELETE for roles: the set is fixed (FR-021), so those
// routes do not exist and a request receives 404.

export default router;
