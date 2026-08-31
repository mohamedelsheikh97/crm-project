import { Router } from 'express';

import messagesRoutes from './messages.routes.js';

const router = Router();

// Mounted under /api/tickets by routes/index.ts. Messages live on the ticket
// path but in their own module with their own permissions, exactly as Phase 4's
// notes do — they are a different thing that happens to hang off a ticket.
router.use(messagesRoutes);

export default router;
