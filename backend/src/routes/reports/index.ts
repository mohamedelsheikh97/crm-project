import { Router } from 'express';

import * as agentController from '../../controllers/reports/agent.controller.js';
import * as csatController from '../../controllers/reports/csat.controller.js';
import * as dashboardController from '../../controllers/reports/dashboard.controller.js';
import * as exportController from '../../controllers/reports/export.controller.js';
import * as slaController from '../../controllers/reports/sla.controller.js';
import * as volumeController from '../../controllers/reports/volume.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { roleHasPermission } from '../../services/authorization.service.js';

/**
 * Reporting endpoints (Phase 10).
 *
 * MOUNTED ON THE `/reports` PREFIX, NEVER BARE, and that is not a stylistic
 * choice. Phase 9 mounted its AI router with a bare `router.use(aiRoutes)` so it
 * could declare full paths in one reviewable file — and because a bare `use`
 * sees EVERY request, its `router.use(authenticate)` then applied to every route
 * registered after it, putting Phase 7's PUBLIC knowledge base behind a token.
 * The lesson is recorded in `routes/ai/index.ts` and this router follows it.
 *
 * `authenticate` and `requirePasswordChange` are applied ONCE for the whole
 * group, as the admin, customer and ticket routers do, so a route added here
 * later cannot omit them. Per-route `requirePermission` calls sit beside each
 * route; the authorization matrix test fails any route without one.
 */
const router = Router();

router.use(authenticate);
router.use(requirePasswordChange);

// The management dashboard. ONE request for every figure, so they all resolve
// against one period (FR-002).
router.get('/dashboard', requirePermission('reports:view'), dashboardController.get);

/**
 * The viewer's OWN arrangement (US6, FR-040).
 *
 * NO ID PARAMETER, and that is the security model rather than a convenience.
 * `/dashboard/arrangement/:userId` would need a check, the check would need
 * testing, and the failure mode is reading or overwriting somebody else's
 * dashboard. The user id comes from the session and from nowhere else.
 *
 * Both sit BEFORE nothing and after `/dashboard`; Express matches the literal
 * path, and neither is a parameter route that could shadow the other.
 */
router.get(
  '/dashboard/arrangement',
  requirePermission('reports:view'),
  dashboardController.getArrangement,
);
router.put(
  '/dashboard/arrangement',
  requirePermission('reports:view'),
  dashboardController.putArrangement,
);

router.get('/volume', requirePermission('reports:view'), volumeController.get);

// Response and resolution compliance, counted over recorded outcomes so the
// figures reconcile to the ticket screen by construction (research D3).
router.get('/sla', requirePermission('reports:view'), slaController.get);

// Satisfaction. `reports:view`, not `reports:view_agents` — a distribution over
// a whole team says nothing about any one agent, and the response-rate
// denominator is tickets rather than people.
router.get('/csat', requirePermission('reports:view'), csatController.get);

/**
 * Agent performance. NOT gated by `requirePermission`, deliberately.
 *
 * `requirePermission` answers 403, and FR-030b requires this report to be
 * ABSENT rather than present-and-withheld — an agent who learns per-agent
 * figures about them exist has been told the thing Clarifications Q1 was meant
 * not to tell them. The gate below reads the SAME permission key the same way
 * and answers 404 instead; it is a change of answer, not of authority. The
 * authorization matrix records this as a conditional permission and names the
 * test that covers it.
 */
router.get(
  '/agents',
  agentController.requireAgentReportOrHide(roleHasPermission),
  agentController.get,
);

/**
 * Export. The `reports:export` permission here, AND the exported report's own
 * permission inside the controller — both, because otherwise `reports:export`
 * becomes a back door to every report through the one surface that produces a
 * file somebody can forward.
 *
 * POST, not GET, because it writes an audit record (FR-051), and because a GET
 * that records something is a GET a link prefetcher can record for you.
 */
router.post('/:report/export', requirePermission('reports:export'), exportController.create);

/**
 * The best-effort PDF print notification. `reports:view` only — the reader was
 * already looking at the screen they printed, and refusing here would lose the
 * record without preventing anything. See `notifyPrint` for why this is a
 * record and not a control.
 */
router.post('/:report/print', requirePermission('reports:view'), exportController.notifyPrint);

export default router;
