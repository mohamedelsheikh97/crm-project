import { Router } from 'express';

import * as settingsController from '../../controllers/admin/settings.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

router.get('/', requirePermission('settings:view'), settingsController.list);

export default router;
