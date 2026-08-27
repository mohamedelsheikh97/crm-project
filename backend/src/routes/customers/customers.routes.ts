import { Router } from 'express';

import * as customersController from '../../controllers/customers/customers.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Delegation only. Every route carries a requirePermission — the matrix test
// fails any that does not.
//
// /export is declared BEFORE /:id, or Express would match "export" as an id.
router.get('/', requirePermission('customers:view'), customersController.list);
router.post('/', requirePermission('customers:create'), customersController.create);
router.post(
  '/check-duplicates',
  requirePermission('customers:create'),
  customersController.checkDuplicates,
);

// Declared BEFORE /:id, or Express matches 'export' as an id.
router.get('/export', requirePermission('customers:export'), customersController.exportCsv);

router.get('/:id', requirePermission('customers:view'), customersController.get);
router.patch('/:id', requirePermission('customers:update'), customersController.update);

// Deactivate and reactivate share one permission deliberately: changing an
// account's active state is one capability, not two.
router.post(
  '/:id/deactivate',
  requirePermission('customers:deactivate'),
  customersController.deactivate,
);
router.post(
  '/:id/reactivate',
  requirePermission('customers:deactivate'),
  customersController.reactivate,
);

// There is deliberately NO DELETE at any path: deactivation is the only
// removal (Clarifications Q1), which is what lets Phase 3 treat a customer
// reference as permanent.

export default router;
