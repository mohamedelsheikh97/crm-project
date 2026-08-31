import { Router } from 'express';

import * as formsController from '../../controllers/forms/forms.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// A published form is a PUBLIC endpoint anyone can submit to, which is why
// defining one is supervisory rather than everyday work (FR-080).
router.get('/', requirePermission('forms:manage'), formsController.list);
router.post('/', requirePermission('forms:manage'), formsController.create);
router.patch('/:id', requirePermission('forms:manage'), formsController.update);

// There is deliberately NO delete route. Unpublishing takes a form out of
// service; deleting it would orphan the tickets that came from it.

export default router;
