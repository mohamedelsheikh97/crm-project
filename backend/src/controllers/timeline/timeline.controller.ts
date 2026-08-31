import type { NextFunction, Request, Response } from 'express';

import { notFound, unauthenticated } from '../../errors/app-error.js';
import * as timelineService from '../../services/timeline.service.js';

/** HTTP concerns only. Visibility filtering lives in the service (FR-090). */
export async function forCustomer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw unauthenticated();

    const customerId = Number(req.params.id);

    if (!Number.isInteger(customerId) || customerId < 1) throw notFound();

    const page = await timelineService.forCustomer(
      customerId,
      { roleId: req.user.roleId },
      { page: req.query.page, pageSize: req.query.pageSize },
    );

    // Lets the interface tell "never corresponded" from "corresponded, but not
    // where you can see it" — two empty states that must not look alike.
    const hasHidden =
      page.total === 0 && (await timelineService.hasAnyCorrespondence(customerId));

    res.status(200).json({ ...page, hasHiddenCorrespondence: hasHidden });
  } catch (error) {
    next(error);
  }
}
