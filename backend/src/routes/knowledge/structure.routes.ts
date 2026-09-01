import { Router } from 'express';

import * as structureController from '../../controllers/knowledge/structure.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

/**
 * READING the structure needs no key beyond being signed in, for the same
 * reason reading a published article does not (FR-053): the article editor has
 * to offer the categories, and every author files articles. A permission every
 * role holds unconditionally would refuse nothing.
 *
 * WRITING is `kb:manage`. Reorganising the filing changes what every reader
 * sees on the front page, which is a different job from writing one article —
 * the same distinction that separates `templates:use` from `templates:manage`.
 */
router.get('/categories', structureController.listCategories);
router.post('/categories', requirePermission('kb:manage'), structureController.createCategory);
router.patch('/categories/:id', requirePermission('kb:manage'), structureController.updateCategory);
// Refused while it still holds articles (FR-015), with the count.
router.delete(
  '/categories/:id',
  requirePermission('kb:manage'),
  structureController.deleteCategory,
);

router.get('/guides', structureController.listGuides);
router.post('/guides', requirePermission('kb:manage'), structureController.createGuide);
router.patch('/guides/:id', requirePermission('kb:manage'), structureController.updateGuide);
// PUT, and the WHOLE sequence: a guide's order is one editorial decision, and a
// partial reorder would leave two steps claiming one position.
router.put(
  '/guides/:id/steps',
  requirePermission('kb:manage'),
  structureController.replaceGuideSteps,
);
// Deletes the guide. The articles in it are untouched — a guide is a join, not
// a container (research D9), which is why this delete needs no warning about
// what it takes with it.
router.delete('/guides/:id', requirePermission('kb:manage'), structureController.deleteGuide);

export default router;
