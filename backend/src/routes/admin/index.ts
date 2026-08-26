import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

import rolesRoutes from './roles.routes.js';
import usersRoutes from './users.routes.js';

const router = Router();

// Applied once for the whole group rather than per route, so a new admin
// router cannot be added without them. Per-resource routers add their own
// requirePermission calls; the matrix test fails any route that omits one.
router.use(authenticate);
router.use(requirePasswordChange);

router.use('/users', usersRoutes);
router.use(rolesRoutes);

export default router;
