import { Router } from 'express';

import * as assignmentController from '../../controllers/assignment/assignment.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

/**
 * `assignment:manage` COVERS COMPETENCIES as well as the strategy and the
 * ceiling, deliberately (see auth/permissions.ts): competency exists only to
 * serve routing, so routing authority is one permission. Splitting them would
 * let a holder of "may edit who is competent" silently redirect work without
 * ever touching the strategy.
 *
 * THE ROUTE GATE IS NOT THE WHOLE STORY. FR-051 additionally requires
 * `tickets:assign`, enforced in the service — so an agent granted this key by
 * misconfiguration is still refused. Configuring automatic assignment is
 * self-assignment by a longer route.
 */
router.get('/', requirePermission('assignment:manage'), assignmentController.getSettings);
router.patch('/', requirePermission('assignment:manage'), assignmentController.updateSettings);

router.get(
  '/competencies',
  requirePermission('assignment:manage'),
  assignmentController.listCompetencies,
);
router.put(
  '/competencies/:userId',
  requirePermission('assignment:manage'),
  assignmentController.replaceCompetencies,
);

export default router;
