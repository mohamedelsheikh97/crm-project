import { Router } from 'express';

import * as automationController from '../../controllers/automation/automation.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

/**
 * TWO PERMISSIONS, and the split is real rather than decorative.
 *
 * `automation:manage` builds rules — configuration that changes what the system
 * does to every future ticket, with no person in the loop when it acts.
 * `automation:view` reads what happened, which is a supervisor's question:
 * "what changed this ticket overnight, and nobody admits to it?"
 *
 * A Supervisor holds the second and not the first, by seeder. Neither is
 * granted to an Agent — the run record spans every ticket in the system.
 */

// The catalog the builder screen reads, so it can never offer a combination the
// validator would refuse.
router.get('/catalog', requirePermission('automation:manage'), automationController.getCatalog);

// `/runs` is declared BEFORE `/rules/:id` would ever be consulted, but they sit
// on different paths so no ordering hazard exists. It carries the other key.
router.get('/runs', requirePermission('automation:view'), automationController.listRuns);

router.get('/rules', requirePermission('automation:manage'), automationController.listRules);
router.post('/rules', requirePermission('automation:manage'), automationController.createRule);

// Before `/rules/:id`, so `order` is never read as an id.
router.put(
  '/rules/order',
  requirePermission('automation:manage'),
  automationController.reorderRules,
);

router.get('/rules/:id', requirePermission('automation:manage'), automationController.getRule);
router.patch('/rules/:id', requirePermission('automation:manage'), automationController.updateRule);
router.delete(
  '/rules/:id',
  requirePermission('automation:manage'),
  automationController.deleteRule,
);

router.post(
  '/rules/:id/enable',
  requirePermission('automation:manage'),
  automationController.enableRule,
);
router.post(
  '/rules/:id/disable',
  requirePermission('automation:manage'),
  automationController.disableRule,
);

export default router;
