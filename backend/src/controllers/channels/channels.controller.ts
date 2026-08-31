import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../../errors/app-error.js';
import { auditContextFrom } from '../../services/audit.service.js';
import * as channelService from '../../services/channel.service.js';

/** HTTP concerns only. The credential refusal lives in the service. */
function actorFrom(req: Request): channelService.Actor {
  if (!req.user) throw unauthenticated();

  return {
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    roleId: req.user.roleId,
  };
}

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await channelService.list());
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res
      .status(200)
      .json(
        await channelService.update(
          String(req.params.channel),
          req.body ?? {},
          actorFrom(req),
          auditContextFrom(req),
        ),
      );
  } catch (error) {
    next(error);
  }
}

export async function intake(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(
      await channelService.unconvertedIntake({
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  } catch (error) {
    next(error);
  }
}
