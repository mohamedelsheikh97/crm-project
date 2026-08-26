import { Router } from 'express';

import * as authController from '../controllers/auth.controller.js';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';

const router = Router();

router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', optionalAuthenticate, authController.logout);
router.post('/change-password', authenticate, authController.changePassword);
router.get('/me', authenticate, authController.me);

export default router;
