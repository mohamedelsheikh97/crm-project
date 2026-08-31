import { Router } from 'express';

import * as channelsController from '../../controllers/channels/channels.controller.js';
import { requirePermission } from '../../middleware/require-permission.js';

const router = Router();

// Reading which channels exist and whether they can work is administration:
// the same grant that changes them, because the configuration state is itself
// operationally sensitive.
router.get('/', requirePermission('channels:manage'), channelsController.list);
router.patch('/:channel', requirePermission('channels:manage'), channelsController.update);

// What arrived and did not become a ticket, so FR-037 and FR-101 have a
// surface rather than only a table.
router.get('/intake', requirePermission('channels:manage'), channelsController.intake);

export default router;
