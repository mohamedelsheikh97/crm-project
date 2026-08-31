import { Router } from 'express';

import * as webhooksController from '../../controllers/channels/webhooks.controller.js';
import * as publicFormsController from '../../controllers/forms/public-forms.controller.js';
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

export default router;
