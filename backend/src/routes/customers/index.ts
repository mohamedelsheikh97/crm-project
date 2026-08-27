import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

const router = Router();

// Applied once for the whole group, as the admin router does, so a new customer
// router cannot be added without them. Per-resource routers add their own
// requirePermission calls; the matrix test fails any route that omits one.
router.use(authenticate);
router.use(requirePasswordChange);

export default router;
