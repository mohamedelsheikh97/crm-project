import { Router } from 'express';

import * as articlesController from '../../controllers/knowledge/articles.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

/**
 * Delegation only. Every route that needs a permission carries one — the matrix
 * test fails any that does not.
 *
 * READING NEEDS NO KEY BEYOND BEING SIGNED IN (FR-053). There is deliberately
 * no `kb:read`: a permission every role holds unconditionally cannot refuse
 * anything, and the roles screen is worse for listing it. Drafts ARE gated, in
 * the service, which returns 404 rather than 403 so the status code does not
 * disclose that a draft is being written.
 */
router.get('/articles', articlesController.list);
router.get('/articles/:id', articlesController.show);

// Writing. The person who just solved something should write it down.
router.post('/articles', requirePermission('kb:author'), articlesController.create);
router.patch('/articles/:id', requirePermission('kb:author'), articlesController.update);

// A DIFFERENT KEY, and the split is the point: publishing is the only quality
// gate this content has. "May write a draft" and "may put words in front of
// customers in the organisation's name" are different authorities.
router.post('/articles/:id/publish', requirePermission('kb:publish'), articlesController.publish);
router.post('/articles/:id/archive', requirePermission('kb:publish'), articlesController.archive);
router.post('/articles/:id/restore', requirePermission('kb:publish'), articlesController.restore);

// THERE IS NO DELETE ROUTE. FR-007: archiving is the removal, and an archived
// article stays readable to its author and restorable by anybody who notices
// the mistake. Its absence needs no explanation beyond the tooltip
// `kb.articles.noDeleteReason`.

export default router;
