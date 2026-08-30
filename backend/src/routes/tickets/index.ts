import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePasswordChange } from '../../middleware/require-password-change.js';

import ticketNotesRoutes from './ticket-notes.routes.js';
import ticketsRoutes from './tickets.routes.js';

const router = Router();

// Applied once for the whole group, as the admin and customer routers do, so a
// router added here later cannot omit them. Per-route requirePermission calls
// live in tickets.routes.ts; the matrix test fails any route without one.
router.use(authenticate);
router.use(requirePasswordChange);

router.use(ticketsRoutes);
// Notes live on the ticket path but in their own file: they are a different
// module with their own permissions, not more ticket endpoints.
router.use(ticketNotesRoutes);

export default router;
