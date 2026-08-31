import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

import channelsRoutes from './channels.routes.js';

const router = Router();

// Applied once for the whole group, as every other router does, so a route
// added here later cannot omit them. The PUBLIC webhook endpoints are
// deliberately NOT mounted here — they live under /api/public with their own
// signature verification instead of authentication (FR-105).
router.use(authenticate);
router.use(requirePasswordChange);
router.use(channelsRoutes);

export default router;
