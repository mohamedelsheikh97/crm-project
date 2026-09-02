import { Router } from 'express';

import * as controller from '../../controllers/admin/erp.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

/**
 * ERP synchronisation (Phase 11, US4, FR-061).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `erp:sync` FOR RUNNING, `integrations:manage` FOR READING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two keys because the two actions differ in kind. Everything behind
 * `integrations:manage` is configuration and reading; running a sync is the only
 * action in this phase that authorises a SECOND WRITER to touch data a person
 * entered — and the failure it can cause, an agent's correction silently
 * replaced, is invisible on every screen (FR-043).
 *
 * Holding `erp:sync` does not imply `integrations:manage`, so somebody can be
 * permitted to run the nightly reconciliation without also being able to issue
 * credentials to third parties.
 *
 * `POST /sync` is the probe target the authorization matrix aims at. It is a
 * POST rather than a GET because it writes.
 */
const router = Router();

/**
 * Which adapter is active, and the field-ownership table.
 *
 * READ-ONLY, so `integrations:manage`. An administrator about to run a sync
 * needs to see which system wins each field before they run it — the difference
 * between an informed decision and finding out afterwards.
 */
router.get('/', requirePermission('integrations:manage'), controller.describeAdapter);

/**
 * The preview writes nothing to customers (FR-044), but it is still `erp:sync`.
 *
 * It reads the ERP, creates a run row, and is the decision that precedes the
 * real one — somebody who may not run a sync has no business starting one in
 * dry-run either, and gating it differently would invite "just preview it for
 * me" as a way around the split.
 */
router.post('/sync/preview', requirePermission('erp:sync'), controller.preview);

router.post('/sync', requirePermission('erp:sync'), controller.apply);

router.get('/runs', requirePermission('integrations:manage'), controller.listRuns);
router.get('/runs/:id', requirePermission('integrations:manage'), controller.runDetail);

export default router;
