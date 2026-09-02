import { Router, type RequestHandler } from 'express';

import { ROUTES } from '../../api/v1/catalog.js';
import { env } from '../../config/env.js';
import * as customersController from '../../controllers/v1/customers.controller.js';
import * as metaController from '../../controllers/v1/meta.controller.js';
import * as reportsController from '../../controllers/v1/reports.controller.js';
import * as ticketsController from '../../controllers/v1/tickets.controller.js';
import {
  authenticateClient,
  requireClientPermission,
  requireClientPermissionOrHide,
} from '../../middleware/authenticate-client.js';
import { rateLimitKeyed } from '../../lib/rate-limit.js';

/**
 * THE PUBLISHED INTERFACE (Phase 11, research D1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MOUNTED UNDER A PREFIX, NEVER BARE. THIS IS THE THIRD TIME.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 9 mounted its AI router with a bare `router.use(aiRoutes)` so it could
 * declare full paths in one reviewable file — and because a bare `use` sees
 * EVERY request, the `authenticate` inside it applied to every route registered
 * after that line, silently putting Phase 7's PUBLIC knowledge base behind a
 * token. Phase 10's report router carries the note. A bare mount here would be
 * worse still: it would offer MACHINE-CREDENTIAL authentication to every staff
 * route below it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE VERSION IS IN THE PATH, AND THAT MAKES FR-002 STRUCTURAL.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A request without a version does not reach a versioned handler at all — it
 * lands on `/api/customers`, which runs `authenticate` and refuses a credential
 * that is not a JWT. There is no code path in which a missing version is served
 * the newest shape, because there is no code that could choose one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ROUTES COME FROM THE CATALOG, NOT FROM THIS FILE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `api/v1/catalog.ts` declares them; this mounts them and `api/openapi.ts`
 * describes them. One declaration means "documented" and "served" are the same
 * fact, which is what FR-005 asks for — a second list would drift, and the drift
 * would be invisible until an integrator called an endpoint that no longer
 * exists.
 *
 * GET ONLY in version 1 (research D16). `tests/api/read-only.test.ts` reads the
 * catalog and fails on any other method.
 */
const CONTROLLERS = {
  customers: customersController,
  tickets: ticketsController,
  reports: reportsController,
  meta: metaController,
} as const;

/**
 * The unauthenticated half: the interface's own description.
 *
 * Its own router so it sits outside `authenticateClient` structurally rather
 * than by being written above a line somebody could move. An integrator reads
 * the document BEFORE they have a working credential — it is the first thing
 * they open — and it describes shapes, never data.
 */
export const publicV1Router = Router();

const router = Router();

/**
 * Every response says which version produced it.
 *
 * Redundant with the path by design: a response captured in a log, or pasted
 * into a support ticket by an integrator, still states what produced it — and
 * the first thing anybody debugging an integration wants to know is which
 * version they actually called.
 */
function stampVersion(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-CRM-API-Version', '1');
    next();
  };
}

publicV1Router.use(stampVersion());
router.use(stampVersion());

/**
 * Authentication for the whole authenticated group, applied ONCE.
 *
 * The same discipline the admin, customer, ticket and report routers use: a
 * route added here later cannot omit it.
 */
router.use(authenticateClient);

/**
 * Rate limiting, KEYED ON THE CREDENTIAL rather than the IP address.
 *
 * An IP key would be wrong in both directions here: several integrations behind
 * one NAT would share a budget they did not agree to share, and one integration
 * spread across a fleet would get as many budgets as it had machines. The
 * credential is the thing being metered.
 *
 * Applied after `authenticateClient` because it needs `req.apiClient` — which
 * also means an unauthenticated flood is refused by the authenticator first,
 * without consuming anybody's budget.
 *
 * `429` is distinguishable from `403` by design (FR-011): one means slow down,
 * the other means you never had access, and a client that confuses them either
 * gives up when it should retry or hammers when it should stop.
 */
router.use(
  rateLimitKeyed('api-v1', env.API_RATE_LIMIT_PER_WINDOW, (req) =>
    req.apiClient ? `client:${req.apiClient.id}` : 'anonymous',
  ),
);

for (const route of ROUTES) {
  const controller = CONTROLLERS[route.controller] as unknown as Record<string, RequestHandler>;
  const handler = controller[route.handler];

  if (!handler) {
    // A catalog row naming a handler that does not exist is a programming
    // error, and it should stop the process at startup rather than 500 on the
    // first request an integrator makes.
    throw new Error(
      `routes/v1: ${route.controller}.${route.handler} is declared in the catalog but not exported`,
    );
  }

  if (route.permission === null) {
    // The description document only. Registered on the unauthenticated router.
    publicV1Router[route.method](route.path, handler);
    continue;
  }

  if (route.permission === 'authenticated') {
    // A credential, but no particular key. `authenticateClient` above has
    // already run, so reaching the handler means `req.apiClient` is populated.
    router[route.method](route.path, handler);
    continue;
  }

  const gate =
    route.onDenied === 'hide'
      ? requireClientPermissionOrHide(route.permission)
      : requireClientPermission(route.permission);

  router[route.method](route.path, gate, handler);
}

export default router;
