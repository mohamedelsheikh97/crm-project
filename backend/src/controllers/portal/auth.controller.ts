import type { CookieOptions, NextFunction, Request, Response } from 'express';

import { env } from '../../config/env.js';
import { unauthenticated } from '../../errors/app-error.js';
import * as auditService from '../../services/audit.service.js';
import * as portalAuthService from '../../services/portal-auth.service.js';
import * as portalInvitationService from '../../services/portal-invitation.service.js';
import {
  PORTAL_ACCESS_TOKEN_TTL_SECONDS,
  PORTAL_REFRESH_TOKEN_TTL_SECONDS,
} from '../../services/portal-token.service.js';

/**
 * Portal sessions (Phase 8).
 *
 * A SEPARATE COOKIE FROM THE STAFF ONE, on a separate path. An agent testing the
 * portal on the same browser they work in is an ordinary thing to do, and one
 * cookie name would mean signing into one surface silently signed them out of
 * the other. The `path` scoping also means the portal's refresh token is never
 * sent to a staff endpoint, and vice versa — belt to the realm separation's
 * braces (research D1).
 */
export const PORTAL_REFRESH_COOKIE_NAME = 'crm_portal_refresh';

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/api/portal/auth',
  secure: env.NODE_ENV !== 'development',
};

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body ?? {};

    const { session, accessToken, refreshToken } = await portalAuthService.login(email, password, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    res.cookie(PORTAL_REFRESH_COOKIE_NAME, refreshToken, {
      ...refreshCookieOptions,
      maxAge: PORTAL_REFRESH_TOKEN_TTL_SECONDS * 1000,
    });

    // The customer's own address and language, and nothing else. No ids: the
    // account id is inside the token and is not something the page needs.
    res.status(200).json({
      accessToken,
      expiresIn: PORTAL_ACCESS_TOKEN_TTL_SECONDS,
      customer: { email: session.email, language: session.language },
    });
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[PORTAL_REFRESH_COOKIE_NAME];

    if (typeof token !== 'string' || token.length === 0) {
      next(unauthenticated());
      return;
    }

    const { session, accessToken } = await portalAuthService.refresh(token);

    // No new refresh cookie: the window is absolute rather than sliding, exactly
    // as Phase 1 decided for staff.
    res.status(200).json({
      accessToken,
      expiresIn: PORTAL_ACCESS_TOKEN_TTL_SECONDS,
      customer: { email: session.email, language: session.language },
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Same path and options as the cookie that was set, or the browser will not
    // clear it. Succeeds with no cookie — logout is idempotent, and failing to
    // log out is worse than logging out twice.
    res.clearCookie(PORTAL_REFRESH_COOKIE_NAME, refreshCookieOptions);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** The customer's own "sign out everywhere" (FR-007). */
export async function logoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.portal) {
      next(unauthenticated());
      return;
    }

    await portalAuthService.revokeAllSessions(req.portal.accountId);

    res.clearCookie(PORTAL_REFRESH_COOKIE_NAME, refreshCookieOptions);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.portal) {
      next(unauthenticated());
      return;
    }

    const { currentPassword, newPassword } = req.body ?? {};

    await portalAuthService.changePassword(req.portal.accountId, currentPassword, newPassword);

    // The password change ended every session, including this one. Clearing the
    // cookie is honest about that rather than leaving a dead token in place.
    res.clearCookie(PORTAL_REFRESH_COOKIE_NAME, refreshCookieOptions);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * ALWAYS 204, whatever the address (FR-006, SC-006).
 *
 * No branch, no timing difference worth measuring, and no message that varies.
 * Anything else makes this endpoint a way to enumerate the organisation's
 * customer list one address at a time.
 */
export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await portalInvitationService.requestReset(
      req.body?.email,
      null,
      auditService.auditContextFrom(req),
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token, password } = req.body ?? {};

    await portalInvitationService.completeReset(token, password);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.portal) {
      next(unauthenticated());
      return;
    }

    // The contact's own address and its customer's display name. NOT the
    // customer's address, contacts, company, or any other contact on the record
    // — a portal account is one person's view, not a directory.
    res.status(200).json({
      email: req.portal.email,
      language: req.portal.language,
    });
  } catch (error) {
    next(error);
  }
}

/** The only field a customer may change about themselves (FR-064). */
export async function setLanguage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.portal) {
      next(unauthenticated());
      return;
    }

    const language = await portalAuthService.setLanguage(req.portal.accountId, req.body?.language);

    res.status(200).json({ language });
  } catch (error) {
    next(error);
  }
}
