import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

import tasksRoutes from './tasks.routes.js';

const router = Router();

// Applied once for the whole group, as the admin, customer, and ticket routers
// do, so a router added here later cannot omit them. Per-route
// requirePermission calls live in tasks.routes.ts; the matrix test fails any
// route without one.
router.use(authenticate);
router.use(requirePasswordChange);

router.use(tasksRoutes);

export default router;
