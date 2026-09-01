import { Router } from 'express';

import * as searchController from '../../controllers/knowledge/search.controller.js';

const router = Router();

/**
 * Searching needs no permission beyond being signed in, for the same reason
 * reading a published article does not (FR-053). There is no `kb:read` key: a
 * permission every role holds unconditionally cannot refuse anything.
 *
 * What the search may REACH is decided by the controller, which passes
 * `audience: 'internal'` as a literal — never by the caller.
 */
router.get('/search', searchController.search);

export default router;
