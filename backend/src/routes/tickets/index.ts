import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

import ticketsRoutes from './tickets.routes.js';

const router = Router();

// Applied once for the whole group, as the admin and customer routers do, so a
// router added here later cannot omit them. Per-route requirePermission calls
// live in tickets.routes.ts; the matrix test fails any route without one.
router.use(authenticate);
router.use(requirePasswordChange);

router.use(ticketsRoutes);

export default router;
