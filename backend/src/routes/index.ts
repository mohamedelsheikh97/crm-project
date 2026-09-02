import { Router } from 'express';

import { env } from '../config/env.js';

import adminRoutes from './admin/index.js';
import authRoutes from './auth.routes.js';
import channelRoutes from './channels/index.js';
import customerRoutes from './customers/index.js';
import dashboardRoutes from './dashboard/index.js';
import formRoutes from './forms/index.js';
import healthRoutes from './health.routes.js';
import knowledgeRoutes from './knowledge/index.js';
import notificationRoutes from './notifications/index.js';
import aiRoutes from './ai/index.js';
import portalRoutes from './portal/index.js';
import reportRoutes from './reports/index.js';
import publicRoutes from './public/index.js';
import taskRoutes from './tasks/index.js';
import templateRoutes from './templates/index.js';
import ticketRoutes from './tickets/index.js';
import v1Routes, { publicV1Router } from './v1/index.js';

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

// Phase 9. UNDER A PREFIX, and it has to be: this router applies
// `authenticate`, and mounted bare it would apply it to every route registered
// after this line — which is what it did in the first version, silently putting
// Phase 7's public knowledge base behind a token. Ticket-scoped AI routes live
// in routes/tickets/ai.routes.ts, inside the tickets group.
router.use('/ai', aiRoutes);

// Phase 10. Under a prefix, for the same reason the AI router is: this router
// applies `authenticate`, and a bare mount would apply it to every route
// registered after this line.
router.use('/reports', reportRoutes);

// Phase 4. All four are top level for the same reason: this is the workspace an
// agent lives in, not administration. Managing the template LIBRARY is
// administration, but using a template is not, so the split lives in the
// permissions (templates:use against templates:manage) rather than in the path.
router.use('/dashboard', dashboardRoutes);
router.use('/notifications', notificationRoutes);
router.use('/tasks', taskRoutes);
router.use('/templates', templateRoutes);

// Phase 5. Channel and form ADMINISTRATION — authenticated and permission
// gated like everything above. Message routes are mounted under /tickets and
// the timeline under /customers, because both hang off an existing record
// rather than standing alone.
router.use('/channels', channelRoutes);
router.use('/forms', formRoutes);

// Phase 7. Top level, for the reason customers and tickets are: writing down
// what you have just worked out is everyday work, not administration. Only the
// filing STRUCTURE is administration, and that distinction lives in the
// permission (kb:manage) rather than in the path.
//
// The PUBLIC help centre is not here. It is mounted below with every other
// unauthenticated surface, so that file stays the one place a reviewer can see
// the whole of it at once.
router.use('/knowledge', knowledgeRoutes);

// Phase 8. THE SECOND IDENTITY REALM, in its own file for the same reason the
// public surface has one: everything under it is reached by somebody who does
// not work here, holding a token this application's staff middleware refuses.
// Nothing above this line accepts a portal token, and nothing below it accepts a
// staff one — and that is enforced by separate signing secrets rather than by
// this comment (research D1).
router.use('/portal', portalRoutes);

// Phase 11. THE FOURTH IDENTITY REALM, and the second one with its own
// credential type.
//
// Under a prefix for the reason the AI and report routers are — this router
// applies its OWN authenticator, and a bare mount would offer
// machine-credential authentication to every staff route registered after it,
// which is a worse version of the defect Phase 9 shipped.
//
// The version lives in the path, so a request without one cannot be served: it
// lands on the unversioned staff surface and is refused there for want of a JWT.
// FR-002 is therefore structural rather than a check somebody has to remember.
//
// CONDITIONAL ON `INTEGRATIONS_ENABLED`, and the answer when it is off is 404
// rather than 401 (FR-067). Absent, not refusing: a 401 would tell a caller the
// interface exists and they merely lack a credential, when in fact this
// deployment does not publish one at all. Not mounting it is also what makes
// SC-026's claim — that the Phase 0-10 suite passes unchanged — true by
// construction rather than by hoping nothing leaked.
if (env.INTEGRATIONS_ENABLED) {
  // The description sits outside the authenticator: an integrator reads it
  // before they have a credential, and it describes shapes rather than data.
  router.use('/v1', publicV1Router);
  router.use('/v1', v1Routes);
}

// THE ONLY UNAUTHENTICATED SURFACES IN THIS PROJECT (FR-105), gathered under
// one prefix and one file so the whole public attack surface is reviewable at
// a glance. Everything above this line requires a session; nothing below it
// does. Mounted last so that ordering is impossible to miss when reading.
router.use('/public', publicRoutes);

export default router;
