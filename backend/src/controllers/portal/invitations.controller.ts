import type { NextFunction, Request, Response } from 'express';

import * as auditService from '../../services/audit.service.js';
import * as portalInvitationService from '../../services/portal-invitation.service.js';
import {
  PORTAL_ACCESS_TOKEN_TTL_SECONDS,
  PORTAL_REFRESH_TOKEN_TTL_SECONDS,
} from '../../services/portal-token.service.js';

import { PORTAL_REFRESH_COOKIE_NAME } from './auth.controller.js';
import { env } from '../../config/env.js';
import type { CookieOptions } from 'express';

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/api/portal/auth',
  secure: env.NODE_ENV !== 'development',
};

/**
 * Invitation acceptance (Phase 8, FR-002).
 *
 * THE ONLY ENDPOINT IN THIS APPLICATION THAT CREATES A PORTAL ACCOUNT. There is
 * no registration route, and nobody can mint the token this one requires.
 *
 * Both handlers pass the token straight to the service and add nothing. Every
 * decision — usable or not, and the single identical refusal for the four ways it
 * can fail — lives there, because a controller that reshaped the error would be a
 * place the four cases could become distinguishable again.
 */

export async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const view = await portalInvitationService.view(req.params.token, 'invitation');

    res.status(200).json(view);
  } catch (error) {
    next(error);
  }
}

export async function accept(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { password, language } = req.body ?? {};

    const { session, accessToken, refreshToken } = await portalInvitationService.accept(
      req.params.token,
      password,
      language,
      auditService.auditContextFrom(req),
    );

    // Signed in immediately. Making somebody who has just chosen a password type
    // it again on a sign-in screen is a step that exists only because the code
    // was easier to write that way.
    res.cookie(PORTAL_REFRESH_COOKIE_NAME, refreshToken, {
      ...refreshCookieOptions,
      maxAge: PORTAL_REFRESH_TOKEN_TTL_SECONDS * 1000,
    });

    res.status(201).json({
      accessToken,
      expiresIn: PORTAL_ACCESS_TOKEN_TTL_SECONDS,
      customer: { email: session.email, language: session.language },
    });
  } catch (error) {
    next(error);
  }
}
