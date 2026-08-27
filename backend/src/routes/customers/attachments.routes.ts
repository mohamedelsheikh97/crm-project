import { Router } from 'express';

import * as attachmentsController from '../../controllers/customers/attachments.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { uploadSingleFile } from '../../middleware/upload.js';

const router = Router({ mergeParams: true });

router.get('/', requirePermission('customers:view'), attachmentsController.list);

// Download is permission-checked like every other route. There is NO static
// file middleware anywhere near the storage directory, and there must not be.
router.get(
  '/:attachmentId/download',
  requirePermission('customers:view'),
  attachmentsController.download,
);

router.post(
  '/',
  requirePermission('attachments:upload'),
  uploadSingleFile,
  attachmentsController.upload,
);

router.delete(
  '/:attachmentId',
  requirePermission('attachments:delete'),
  attachmentsController.remove,
);

export default router;
