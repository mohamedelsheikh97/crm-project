import { Router, type NextFunction, type Request, type Response } from 'express';

import { env } from '../../config/env.js';
import * as portalAuthController from '../../controllers/portal/auth.controller.js';
import * as portalInvitationsController from '../../controllers/portal/invitations.controller.js';
import * as portalKbController from '../../controllers/portal/kb.controller.js';
import * as portalSatisfactionController from '../../controllers/portal/satisfaction.controller.js';
import * as portalTicketsController from '../../controllers/portal/tickets.controller.js';
import { validationError } from '../../errors/app-error.js';
import { rateLimit, rateLimitKeyed } from '../../lib/rate-limit.js';
import { authenticatePortal } from '../../middleware/authenticate-portal.js';

const router = Router();

/**
 * THE ENTIRE CUSTOMER-REACHABLE AUTHENTICATED SURFACE (Phase 8, FR-018,
 * research.md D10).
 *
 * This file is the portal's answer to `routes/public/index.ts`, and it exists
 * for the reason that file states about itself: "Every other router in this
 * project begins with `authenticate`; this one deliberately does not, and
 * keeping that exception in a single visible place is what stops it spreading."
 *
 * The portal is the SECOND exception to "authenticated means staff". Everything
 * mounted here is reached by somebody the organisation does not employ, using a
 * token from a different realm, and none of it is evaluated against the staff
 * permission catalog. Four rules hold for every route below:
 *
 *   - it is rate limited on its own scope, so exhausting one cannot deny service
 *     to another (FR-010, FR-025, FR-045)
 *   - it accepts NO FILES (FR-022) — refused at this router, not per handler
 *   - it derives the customer and contact from the SESSION, never the request
 *     (FR-015)
 *   - every read is scoped inside its query by `portalScope` (FR-016)
 *
 * `portal/endpoints.ts` declares this list a second time, on purpose. The realm
 * and scope matrices iterate that declaration, so a route added here without a
 * declaration is caught by the reconciliation test rather than by nobody.
 *
 * WHY THE UNAUTHENTICATED PORTAL ROUTES ARE HERE AND NOT IN `routes/public`:
 * sign-in, credential recovery, and invitation acceptance need no session, but
 * they are not reachable by "somebody with no credential" — an invitation token
 * IS a credential, and the auth routes are how a credential is exchanged for a
 * session. `routes/public/index.ts` means the surface a total stranger can
 * reach, and keeping that meaning exact is worth more than gathering everything
 * that lacks a `Bearer` header into one file.
 */

/**
 * NO INBOUND FILES, ANYWHERE (Clarifications Q3, FR-022).
 *
 * Refused here rather than omitted per handler, because "we never wrote an
 * upload handler" is not the same promise as "this surface rejects files". A
 * multipart body would otherwise arrive, be ignored by `express.json`, and
 * surface as a confusing validation error about a missing subject — which reads
 * as a bug rather than as a decision.
 *
 * Phase 2 deferred virus scanning with an explicit instruction to revisit it
 * before this phase. Q3's answer is to decline the capability rather than the
 * safeguard, so the deferral is neither resolved by ignoring it nor rolled
 * forward invisibly. Lifting this means adding a scanning step first.
 */
function refuseUploads(req: Request, _res: Response, next: NextFunction): void {
  const contentType = req.headers['content-type'];

  if (contentType && /^multipart\//i.test(contentType)) {
    next(
      validationError([
        {
          field: 'attachments',
          message:
            'The portal does not accept files. Reply to the request by email and attach the file there.',
        },
      ]),
    );
    return;
  }

  next();
}

router.use(refuseUploads);

/** Authenticated portal reads and writes key on the ACCOUNT, not the address (D11). */
const byAccount = (scope: string, multiplier = 1) =>
  rateLimitKeyed(scope, env.PORTAL_RATE_PER_MINUTE * multiplier, (req) =>
    req.portal ? `account:${req.portal.accountId}` : `ip:${req.ip ?? 'unknown'}`,
  );

// ---------------------------------------------------------------------------
// Session. Unauthenticated by necessity: these are how a session begins, ends,
// or is recovered. None of them reads a customer's records, and every failure
// is the same 401 whether or not the address exists (FR-006).
// ---------------------------------------------------------------------------

// TIGHT, and keyed by address rather than by account, because the flood being
// defended against here is somebody looking for an account that exists.
const authLimit = rateLimit('portal-auth', env.PORTAL_RATE_PER_MINUTE);

router.post('/auth/login', authLimit, portalAuthController.login);
router.post('/auth/refresh', authLimit, portalAuthController.refresh);
// Idempotent, exactly as Phase 1's staff logout is: it succeeds with no cookie
// and no token, because failing to log out is worse than logging out twice.
router.post('/auth/logout', authLimit, portalAuthController.logout);
router.post('/auth/forgot-password', authLimit, portalAuthController.forgotPassword);
router.post('/auth/reset-password', authLimit, portalAuthController.resetPassword);

// ---------------------------------------------------------------------------
// Invitation acceptance. The ONLY path in this application that creates a portal
// account (FR-002a). There is no registration route, and its absence is a
// requirement rather than an omission.
// ---------------------------------------------------------------------------

const inviteLimit = rateLimit('portal-invite', env.PORTAL_RATE_PER_MINUTE);

router.get('/invitations/:token', inviteLimit, portalInvitationsController.show);
router.post('/invitations/:token/accept', inviteLimit, portalInvitationsController.accept);

// ---------------------------------------------------------------------------
// EVERYTHING BELOW THIS LINE REQUIRES A PORTAL SESSION.
//
// Applied once, to the rest of the router, rather than per route — the mistake
// this guards against is a route added later without it, and a single `use` is
// the only version of this that cannot be forgotten.
// ---------------------------------------------------------------------------

router.use(authenticatePortal);

router.post('/auth/logout-all', byAccount('portal-auth'), portalAuthController.logoutAll);
router.post('/auth/change-password', byAccount('portal-auth'), portalAuthController.changePassword);

// The customer's own contact, and the one field they may change. NOT their name,
// address, or contacts: Phase 2 owns customer data, and a customer who could
// change the email their account is keyed to could move their own identity.
router.get('/me', byAccount('portal-read', 3), portalAuthController.me);
router.patch('/me/language', byAccount('portal-read', 3), portalAuthController.setLanguage);

// ---------------------------------------------------------------------------
// Requests. Reading is generous; writing is not, and they are separate scopes so
// a flood of submissions cannot stop a customer reading (FR-025).
// ---------------------------------------------------------------------------

const readLimit = () => byAccount('portal-read', 3);

router.get('/tickets', readLimit(), portalTicketsController.list);
router.post('/tickets', byAccount('portal-submit'), portalTicketsController.create);
router.get('/tickets/:reference', readLimit(), portalTicketsController.show);
router.post(
  '/tickets/:reference/replies',
  byAccount('portal-reply'),
  portalTicketsController.reply,
);
router.get(
  '/tickets/:reference/attachments/:attachmentId',
  readLimit(),
  portalTicketsController.downloadAttachment,
);
router.post(
  '/tickets/:reference/satisfaction',
  byAccount('portal-submit'),
  portalSatisfactionController.submit,
);

// ---------------------------------------------------------------------------
// Help content. Phase 7's services, unchanged, with `audience: 'customer'` and
// `status: 'published'` passed as LITERALS by the controller. No parameter on any
// of these routes can widen either (FR-039, FR-040).
//
// Search and suggestion carry a tighter scope than reading, on the principle
// Phase 7 applied publicly: a flood of searches must not exhaust the allowance
// for reading, because the customer part-way through an article should not lose
// it.
// ---------------------------------------------------------------------------

router.get('/kb/categories', readLimit(), portalKbController.categories);
router.get('/kb/articles/:slug', readLimit(), portalKbController.article);
router.get('/kb/search', byAccount('portal-search'), portalKbController.search);
router.get('/kb/suggestions', byAccount('portal-search'), portalKbController.suggestions);

/**
 * WHAT IS DELIBERATELY ABSENT HERE, stated so a later phase adds it on purpose:
 *
 *   - No registration, and no other route that creates an account (FR-002a).
 *   - No upload of any kind (FR-022) — refused above for the whole router.
 *   - No route taking a customer or contact id. Both come from the session.
 *   - No route editing customer data. Phase 2 owns it.
 *   - No SLA, note, task, assignee, automation, or history endpoint. Not
 *     filtered — absent (FR-031).
 *   - No aggregate endpoint of any kind. A count is a disclosure: "how many
 *     requests does my company have?" is a question about colleagues.
 */

export default router;
