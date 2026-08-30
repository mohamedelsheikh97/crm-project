import { Router } from 'express';

import adminRoutes from './admin/index.js';
import authRoutes from './auth.routes.js';
import customerRoutes from './customers/index.js';
import dashboardRoutes from './dashboard/index.js';
import healthRoutes from './health.routes.js';
import notificationRoutes from './notifications/index.js';
import taskRoutes from './tasks/index.js';
import templateRoutes from './templates/index.js';
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

// Phase 4. All four are top level for the same reason: this is the workspace an
// agent lives in, not administration. Managing the template LIBRARY is
// administration, but using a template is not, so the split lives in the
// permissions (templates:use against templates:manage) rather than in the path.
router.use('/dashboard', dashboardRoutes);
router.use('/notifications', notificationRoutes);
router.use('/tasks', taskRoutes);
router.use('/templates', templateRoutes);

export default router;
