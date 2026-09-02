import { Router } from 'express';

import * as controller from '../../controllers/admin/integrations.controller.js';
import erpRoutes from './erp.routes.js';
import { requirePermission } from '../../middleware/require-permission.js';

/**
 * Integration administration (Phase 11, US2, US3, FR-061).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY ROUTE CARRIES `integrations:manage`. IT IS NOT IMPLIED BY ANYTHING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FR-061 requires integration administration to need a distinct authority —
 * holding it must not follow from general administration of users or settings.
 * The reason is what a credential IS: a standing grant of read access to this
 * organisation's customer and ticket data, handed to a party outside it, that
 * keeps working until somebody revokes it. That is a narrower judgement than
 * "may configure the application".
 *
 * `authenticate` and `requirePasswordChange` come from the parent admin router,
 * applied once for the whole group, so a route added here cannot omit them. The
 * authorization matrix test fails any route with no `requirePermission` of its
 * own.
 *
 * ERP sync sits in its own router under `erp:sync`, because running a sync
 * writes to customer records and reading this configuration does not.
 */
const router = Router();

/**
 * What the CALLING administrator may grant (FR-020).
 *
 * Ahead of the client routes because the screen reads it first: offering a
 * checkbox the create call would then refuse is worse than not offering it.
 */
router.get(
  '/grantable-permissions',
  requirePermission('integrations:manage'),
  controller.grantablePermissions,
);

router.get('/clients', requirePermission('integrations:manage'), controller.listClients);
router.post('/clients', requirePermission('integrations:manage'), controller.createClient);

/**
 * Rotation and revocation are POSTs on the credential rather than PATCHes of a
 * field, because neither is an edit — one issues a new secret and the other ends
 * an access relationship. A `PATCH { isActive: false }` would make revocation
 * look like a toggle somebody could flip back, and it is not: the secret stays
 * dead.
 */
router.post(
  '/clients/:id/rotate',
  requirePermission('integrations:manage'),
  controller.rotateClientSecret,
);
router.post(
  '/clients/:id/revoke',
  requirePermission('integrations:manage'),
  controller.revokeClient,
);

router.get(
  '/subscriptions',
  requirePermission('integrations:manage'),
  controller.listSubscriptions,
);
router.post(
  '/subscriptions',
  requirePermission('integrations:manage'),
  controller.createSubscription,
);
router.post(
  '/subscriptions/:id/rotate',
  requirePermission('integrations:manage'),
  controller.rotateSubscriptionSecret,
);
router.post(
  '/subscriptions/:id/deactivate',
  requirePermission('integrations:manage'),
  controller.deactivateSubscription,
);

// ERP synchronisation, in its own file because it is gated differently: reading
// this configuration is `integrations:manage`, but RUNNING a sync is `erp:sync`
// — the only action in this phase that authorises a second writer to touch data
// a person entered.
router.use('/erp', erpRoutes);

export default router;
