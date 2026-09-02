import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';
import * as featuresController from '../../controllers/ai/features.controller.js';

/**
 * Which AI surfaces to offer (Phase 9).
 *
 * MOUNTED UNDER A PATH PREFIX, and that detail is load-bearing.
 *
 * The first version of this router was mounted with a bare
 * `router.use(aiRoutes)` so it could declare full paths like
 * `/tickets/:id/ai/summary` in one reviewable file. A bare `use` sees EVERY
 * request, so the `router.use(authenticate)` below then applied to every route
 * registered after it — including Phase 7's PUBLIC knowledge base, which
 * started demanding a token.
 *
 * It was caught by `backend/tests/ai/disabled.test.ts` asserting that the
 * public KB still answers anonymously. The lesson is narrow and worth keeping:
 * a router that applies authentication must be mounted on a prefix, never on
 * the root.
 *
 * Ticket-scoped AI routes now live in `routes/tickets/ai.routes.ts`, inside the
 * tickets group where `authenticate` already applies to that group and nothing
 * else.
 */
const router = Router();

router.use(authenticate);
router.use(requirePasswordChange);

// No permission gate: it refuses nothing, and a key every role holds is noise
// rather than a control (research D12).
router.get('/features', featuresController.list);

export default router;
