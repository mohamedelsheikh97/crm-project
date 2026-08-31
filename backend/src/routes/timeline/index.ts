import { Router } from 'express';

import timelineRoutes from './timeline.routes.js';

const router = Router();

// Mounted under /api/customers, which already applies authenticate and
// requirePasswordChange for the whole group.
router.use(timelineRoutes);

export default router;
