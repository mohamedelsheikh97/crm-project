import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

import assignmentRoutes from '../assignment/assignment.routes.js';
import automationRoutes from '../automation/automation.routes.js';
import alertsRoutes from '../alerts/alerts.routes.js';
import slaRoutes from '../sla/sla.routes.js';

import auditRoutes from './audit.routes.js';
import integrationsRoutes from './integrations.routes.js';
import aiConfigRoutes from './ai-config.routes.js';
import portalAccessRoutes from './portal-access.routes.js';
import rolesRoutes from './roles.routes.js';
import settingsRoutes from './settings.routes.js';
import usersRoutes from './users.routes.js';

const router = Router();

// Applied once for the whole group rather than per route, so a new admin
// router cannot be added without them. Per-resource routers add their own
// requirePermission calls; the matrix test fails any route that omits one.
router.use(authenticate);
router.use(requirePasswordChange);

router.use('/users', usersRoutes);
router.use(rolesRoutes);
router.use('/audit', auditRoutes);
router.use('/settings', settingsRoutes);

// Phase 6. All three sit under /api/admin because they are CONFIGURATION —
// they change what the system does to every future ticket — rather than
// everyday work on one. The generated matrix test walks this router and fails
// any route that omits a permission.
router.use('/sla', slaRoutes);
router.use('/assignment', assignmentRoutes);
router.use('/automation', automationRoutes);
router.use('/alerts', alertsRoutes);

// Phase 8. Ongoing management of who may reach the customer portal. Here rather
// than on the customer router because it is configuration of an outside-facing
// surface; the per-customer READ is on the customer router, where a staff member
// is standing when they ask the question.
router.use('/portal', portalAccessRoutes);

// Phase 9 — AI configuration, the activity record, and chatbot transcripts.
router.use('/ai', aiConfigRoutes);

// Phase 11 — the credentials external systems hold and the addresses this
// system sends notifications to. Under /api/admin because it is configuration
// of an outward-facing surface, and behind its own permission because a
// credential is a standing grant of data access to a party outside this
// organisation rather than an application setting (FR-061).
router.use('/integrations', integrationsRoutes);

export default router;
