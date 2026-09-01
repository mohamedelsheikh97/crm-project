import { Router } from 'express';

import * as webhooksController from '../../controllers/channels/webhooks.controller.js';
import * as publicFormsController from '../../controllers/forms/public-forms.controller.js';
import * as publicKbController from '../../controllers/public/kb.controller.js';
import { env } from '../../config/env.js';
import { rateLimit } from '../../lib/rate-limit.js';

const router = Router();

/**
 * THE ONLY UNAUTHENTICATED SURFACES THIS PHASE INTRODUCES (FR-105).
 *
 * Enumerated here, in one file, on purpose. Every other router in this project
 * begins with `authenticate`; this one deliberately does not, and keeping that
 * exception in a single visible place is what stops it spreading. A route added
 * to any other router inherits authentication. A route added HERE does not, and
 * a reviewer looking at this file can see the entire public attack surface at
 * once.
 *
 * Three rules hold for everything mounted here:
 *
 *   - it is rate limited, independently per scope, so a flood of one kind
 *     cannot exhaust another's allowance (FR-099, FR-100)
 *   - it exposes nothing beyond creating or continuing ONE conversation
 *   - it never discloses whether an address or number is known (FR-106)
 */

// Provider deliveries. Authenticated by SIGNATURE rather than by session — the
// caller is Meta or an SMS gateway, which has no account here. Rate limited
// generously: a legitimate provider can burst, and refusing it means losing
// customer messages.
router.post(
  '/channels/webhooks/:channel',
  rateLimit('webhook', env.INTAKE_RATE_PER_MINUTE * 10),
  webhooksController.receive,
);

// Web forms. Reading a published form is cheap and harmless; submitting one
// creates a ticket and, for an unrecognised sender, a customer record — so the
// two carry different allowances (FR-086).
router.get(
  '/forms/:slug',
  rateLimit('form-read', env.PUBLIC_RATE_PER_MINUTE * 3),
  publicFormsController.show,
);

router.post(
  '/forms/:slug/submissions',
  rateLimit('form-submit', env.PUBLIC_RATE_PER_MINUTE),
  publicFormsController.submit,
);

// --- Phase 7: the public help centre -------------------------------------
//
// THREE ENDPOINTS, READ-ONLY, NO SESSION. They are HERE, in this file, rather
// than beside the rest of the knowledge routes, and that placement is the
// decision worth defending: this file opens by declaring that it exists so a
// reviewer can see the whole unauthenticated surface at once. Phase 7 is the
// first phase to test whether that promise holds, and moving these to
// routes/knowledge/ for tidiness would have broken it on the first try.
//
// What they may reach is decided by controllers/public/kb.controller.ts, which
// passes `audience: 'customer'` and `status: 'published'` as LITERALS. There is
// no parameter on any of these routes that can widen that.
//
// TWO SCOPES, and the separation is the property Phase 5 built `rateLimit`
// for: a flood of searches must not exhaust the allowance for READING. Someone
// hammering search is either enumerating the corpus or careless; either way,
// the customer part-way through an article should not lose it.

// Reading is cheap: a slug lookup and one row. Generous, because a customer
// following a guide legitimately makes several requests in a minute.
router.get(
  '/kb/categories',
  rateLimit('kb-read', env.PUBLIC_RATE_PER_MINUTE * 3),
  publicKbController.categories,
);

router.get(
  '/kb/articles/:slug',
  rateLimit('kb-read', env.PUBLIC_RATE_PER_MINUTE * 3),
  publicKbController.article,
);

// TIGHTER, because it costs more: a tokenisation, an index scan, and a ranking
// pass. It is also the endpoint the public form calls as somebody types, so the
// allowance has to cover a real customer's keystrokes without covering a
// scraper's.
router.get(
  '/kb/search',
  rateLimit('kb-search', env.PUBLIC_RATE_PER_MINUTE),
  publicKbController.search,
);

// WHAT IS DELIBERATELY ABSENT HERE, stated so a later phase adds it on purpose:
//
//   - No POST, PATCH, PUT or DELETE of any kind. This surface accepts NO INPUT
//     beyond a search string and a language (FR-032b) — which removes
//     moderation, spam, and stored injection from the phase entirely.
//   - No "was this helpful?" rating. Phase 8 owns satisfaction feedback, and
//     two rating mechanisms in two phases would be two things to reconcile.
//   - No article listing by category id, and no page parameter. Results are
//     capped, not paged: a public reader reaching page nine is enumerating.

export default router;
