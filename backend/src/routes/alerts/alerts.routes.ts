import { Router } from 'express';

import * as alertsController from '../../controllers/alerts/alerts.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

/**
 * Gated by `sla:manage` rather than a key of its own.
 *
 * Deciding who is told when a commitment is missed is the same administrator's
 * concern as setting the commitment: a person who can define an SLA and not say
 * who hears about a breach has been given half a feature.
 */
router.get('/subscriptions', requirePermission('sla:manage'), alertsController.list);
router.put('/subscriptions', requirePermission('sla:manage'), alertsController.replace);

export default router;
