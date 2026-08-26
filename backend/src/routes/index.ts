import { Router } from 'express';

import adminRoutes from './admin/index.js';
import authRoutes from './auth.routes.js';
import healthRoutes from './health.routes.js';

const router = Router();

// Mounted at /api by app.ts, producing the unversioned prefix FR-020 requires.
router.use(healthRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);

export default router;
