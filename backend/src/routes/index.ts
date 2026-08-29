import { Router } from 'express';

import adminRoutes from './admin/index.js';
import authRoutes from './auth.routes.js';
import customerRoutes from './customers/index.js';
import healthRoutes from './health.routes.js';
import ticketRoutes from './tickets/index.js';

const router = Router();

// Mounted at /api by app.ts, producing the unversioned prefix FR-020 requires.
router.use(healthRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
// Top level, not under /admin: customers are everyday Agent work rather than
// administration.
router.use('/customers', customerRoutes);
// Likewise top level: tickets are the everyday work this system exists for.
router.use('/tickets', ticketRoutes);

export default router;
