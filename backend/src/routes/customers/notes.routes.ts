import { Router } from 'express';

import * as notesController from '../../controllers/customers/notes.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

// mergeParams so :id from the parent path reaches these handlers.
const router = Router({ mergeParams: true });

router.get('/', requirePermission('customers:view'), notesController.list);
router.post('/', requirePermission('notes:create'), notesController.create);

// notes:create is the floor — the service additionally requires notes:manage
// when the note belongs to someone else (FR-027). Keeping that rule in the
// service means it holds for any caller, not just this route.
router.patch('/:noteId', requirePermission('notes:create'), notesController.update);
router.delete('/:noteId', requirePermission('notes:create'), notesController.remove);

export default router;
