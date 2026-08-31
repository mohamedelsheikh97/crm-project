import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

import timelineRoutes from '../timeline/index.js';

import customersRoutes from './customers.routes.js';
import attachmentsRoutes from './attachments.routes.js';
import notesRoutes from './notes.routes.js';

const router = Router();

// Applied once for the whole group, as the admin router does, so a new customer
// router cannot be added without them. Per-resource routers add their own
// requirePermission calls; the matrix test fails any route that omits one.
router.use(authenticate);
router.use(requirePasswordChange);

router.use('/:id/notes', notesRoutes);
router.use('/:id/attachments', attachmentsRoutes);
router.use(customersRoutes);
// Phase 5. The cross-channel conversation view, mounted here because it hangs
// off a customer rather than standing alone. No new permission key: it rides on
// customers:view and is narrowed by ticket visibility in the service (FR-090).
router.use(timelineRoutes);

export default router;
