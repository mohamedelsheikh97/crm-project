import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

import formsRoutes from './forms.routes.js';

const router = Router();

// The PUBLIC submission endpoint is deliberately not here: it lives under
// /api/public with rate limiting instead of authentication (FR-105).
router.use(authenticate);
router.use(requirePasswordChange);
router.use(formsRoutes);

export default router;
