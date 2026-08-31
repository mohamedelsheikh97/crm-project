import { Router } from 'express';

import * as slaController from '../../controllers/sla/sla.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

/**
 * `sla:manage` COVERS THE CALENDAR AS WELL AS THE POLICIES, deliberately (see
 * auth/permissions.ts). A policy expressed in working hours and the definition
 * of a working hour are one administrator's single concern; granting either
 * without the other produces a configuration nobody can reason about.
 *
 * There is no read-only gate. A ticket's own SLA state rides on `tickets:view`
 * and is returned with the ticket, so nothing here is needed to work a ticket.
 */

// Ordered as they are matched (FR-013): the list IS the precedence order.
router.get('/policies', requirePermission('sla:manage'), slaController.listPolicies);
router.post('/policies', requirePermission('sla:manage'), slaController.createPolicy);
router.get('/policies/:id', requirePermission('sla:manage'), slaController.getPolicy);
router.patch('/policies/:id', requirePermission('sla:manage'), slaController.updatePolicy);

// Activate and deactivate. NO DELETE ROUTE — FR-019: a policy tickets were
// measured against must stay readable.
router.post(
  '/policies/:id/activate',
  requirePermission('sla:manage'),
  slaController.activatePolicy,
);
router.post(
  '/policies/:id/deactivate',
  requirePermission('sla:manage'),
  slaController.deactivatePolicy,
);

router.get('/calendar', requirePermission('sla:manage'), slaController.getCalendar);
router.patch('/calendar', requirePermission('sla:manage'), slaController.updateCalendar);
router.post('/calendar/exceptions', requirePermission('sla:manage'), slaController.addException);
router.delete(
  '/calendar/exceptions/:id',
  requirePermission('sla:manage'),
  slaController.removeException,
);

export default router;
