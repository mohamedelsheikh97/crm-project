import { Router } from 'express';

import * as aiConfigController from '../../controllers/admin/ai-config.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

/**
 * AI administration (Phase 9, US6).
 *
 * Mounted under the admin router, which applies `authenticate` and
 * `requirePasswordChange` once for the whole group.
 *
 * EVERY ROUTE CARRIES `ai:manage` (FR-060) — distinct from the tickets,
 * knowledge base, and channels keys, so switching the chatbot on is not a power
 * that arrives with permission to edit an article.
 */
const router = Router();

router.get('/config', requirePermission('ai:manage'), aiConfigController.get);
router.patch('/config', requirePermission('ai:manage'), aiConfigController.patch);

router.get('/activity', requirePermission('ai:manage'), aiConfigController.activity);

router.get('/conversations', requirePermission('ai:manage'), aiConfigController.conversations);
router.get('/conversations/:id', requirePermission('ai:manage'), aiConfigController.conversation);

export default router;
