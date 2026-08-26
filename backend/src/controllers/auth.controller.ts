import type { CookieOptions, NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { unauthenticated } from '../errors/app-error.js';
import * as authService from '../services/auth.service.js';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../services/token.service.js';

export const REFRESH_COOKIE_NAME = 'crm_refresh';

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/api/auth',
  secure: env.NODE_ENV !== 'development',
};

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body ?? {};
    const { user, accessToken, refreshToken } = await authService.login(email, password);

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...refreshCookieOptions,
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    });

    // Only these three fields. password_hash is excluded by the model's
    // defaultScope and never reaches this layer.
    res.status(200).json({ accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, user });
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];

    if (typeof token !== 'string' || token.length === 0) {
      next(unauthenticated());
      return;
    }

    const { accessToken } = await authService.refresh(token);

    // No new refresh cookie: the 7-day window is absolute, not sliding.
    res.status(200).json({ accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  } catch (error) {
    next(error);
  }
}

export function logout(_req: Request, res: Response): void {
  // Same path and options as the cookie that was set, or the browser will not
  // clear it. Succeeds even with no cookie present — logout is idempotent.
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
  res.status(204).send();
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    const current = await authService.getCurrentUser(req.user.id);

    if (!current) {
      next(unauthenticated());
      return;
    }

    res.status(200).json(current);
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
    if (!req.user) {
      next(unauthenticated());
      return;
    }

    const body = req.body ?? {};

    await authService.changePassword(req.user.id, body.currentPassword, body.newPassword, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
