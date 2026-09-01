import { Router } from 'express';

import * as portalAccessController from '../../controllers/admin/portal-access.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

/**
 * Ongoing management of portal access (Phase 8, User Story 8, FR-056 - FR-060a).
 *
 * UNDER /api/admin because it is CONFIGURATION of who may reach the system from
 * outside, not everyday work on one customer — the same reasoning that put SLA
 * policies and automation rules here in Phase 6. The per-customer READ lives on
 * the customer router instead, because that is where a staff member is standing
 * when they ask the question.
 *
 * Delegation only. Every route carries `requirePermission('portal:manage')`, and
 * the generated matrix test fails any that does not.
 *
 * ONE PERMISSION FOR ALL FIVE ACTIONS. Nothing in the spec distinguishes their
 * audiences: they are all "may decide who gets into the portal", and a supervisor
 * who could invite but not withdraw would hold half a remedy for a compromised
 * credential.
 */

router.delete(
  '/invitations/:invitationId',
  requirePermission('portal:manage'),
  portalAccessController.revokeInvitation,
);

// Withdraw and restore are separate routes rather than one toggle, so the audit
// log records which was intended rather than which state it landed in.
router.post(
  '/accounts/:accountId/withdraw',
  requirePermission('portal:manage'),
  portalAccessController.withdraw,
);

router.post(
  '/accounts/:accountId/restore',
  requirePermission('portal:manage'),
  portalAccessController.restore,
);

// Distinct from restore: a lockout is something the system did after failed
// attempts and clears itself; a withdrawal is something a person decided and
// does not. Merging them would let "unlock" silently reverse a revocation.
router.post(
  '/accounts/:accountId/unlock',
  requirePermission('portal:manage'),
  portalAccessController.unlock,
);

export default router;
