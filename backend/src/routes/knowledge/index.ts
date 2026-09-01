import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

import articlesRoutes from './articles.routes.js';
import searchRoutes from './search.routes.js';
import structureRoutes from './structure.routes.js';

const router = Router();

/**
 * The AUTHENTICATED knowledge base.
 *
 * The public help centre is NOT here — it lives in routes/public/index.ts with
 * every other unauthenticated surface, so a reviewer can still see the whole of
 * that surface in one file (research D7). Splitting them across two routers
 * would be tidier by module and much worse by review.
 */
router.use(authenticate);
router.use(requirePasswordChange);

router.use(articlesRoutes);
router.use(searchRoutes);
router.use(structureRoutes);

export default router;
