import { Router } from 'express';

import * as usersController from '../../controllers/admin/users.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Delegation only, no logic. Every route carries a requirePermission — the
// matrix test fails any that does not (contracts/authorization.md).
router.get('/', requirePermission('users:view'), usersController.list);
router.get('/:id', requirePermission('users:view'), usersController.get);
router.post('/', requirePermission('users:create'), usersController.create);
router.patch('/:id', requirePermission('users:update'), usersController.update);

// Deactivate and reactivate share one permission deliberately: changing an
// account's active state is one capability, not two (contracts/admin-api.md).
router.post('/:id/deactivate', requirePermission('users:deactivate'), usersController.deactivate);
router.post('/:id/reactivate', requirePermission('users:deactivate'), usersController.reactivate);

router.post(
  '/:id/reset-password',
  requirePermission('users:reset_password'),
  usersController.resetPassword,
);
router.post('/:id/unlock', requirePermission('users:update'), usersController.unlock);

export default router;
