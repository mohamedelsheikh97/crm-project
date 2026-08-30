import { Router } from 'express';

import * as templatesController from '../../controllers/templates/templates.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Delegation only. Every route carries a requirePermission — the matrix test
// fails any that does not.

// Using the library is everyday work.
router.get('/', requirePermission('templates:use'), templatesController.list);

// Changing it changes what every agent says to customers, so it is a distinct
// grant (FR-069) and it is audited (FR-077).
router.post('/', requirePermission('templates:manage'), templatesController.create);
router.patch('/:id', requirePermission('templates:manage'), templatesController.update);
router.post('/:id/retire', requirePermission('templates:manage'), templatesController.retire);

// There is deliberately NO delete route. A template is retired, which removes
// it from the picker and changes nothing already written from it.

export default router;
