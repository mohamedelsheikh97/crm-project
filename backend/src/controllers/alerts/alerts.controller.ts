import type { NextFunction, Request, Response } from 'express';

import { validationError } from '../../errors/app-error.js';
import { sequelize } from '../../config/database.js';
import * as alertService from '../../services/alert.service.js';
import { AlertSubscription } from '../../models/index.js';
import { isAlertEvent, type AlertEvent } from '../../models/alert-subscription.model.js';

/**
 * Alert subscriptions (FR-079).
 *
 * REPLACED AS A WHOLE, in one transaction. The resource is a small matrix that
 * an administrator edits as a unit, and a partial save would leave events
 * subscribed to nobody — a state that fails silently, at the worst moment, and
 * looks exactly like the feature being off.
 */
export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ events: await alertService.listSubscriptions() });
  } catch (error) {
    next(error);
  }
}

export async function replace(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const events = (req.body ?? {}).events;

    if (!Array.isArray(events)) {
      throw validationError([{ field: 'events', message: 'alerts.error.eventsInvalid' }]);
    }

    const rows: Array<{
      event_key: AlertEvent;
      recipient_kind: 'assignee' | 'role';
      role_id: number | null;
      in_app: boolean;
      by_email: boolean;
      by_sms: boolean;
    }> = [];

    for (const event of events) {
      const eventKey = String((event as { eventKey?: unknown }).eventKey ?? '');

      // A subscription naming an event nothing fires is a row that can never
      // deliver — refused here rather than stored and wondered about later.
      if (!isAlertEvent(eventKey)) {
        throw validationError([{ field: 'eventKey', message: 'alerts.error.eventUnknown' }]);
      }

      for (const subscription of (event as { subscriptions?: unknown[] }).subscriptions ?? []) {
        const entry = subscription as Record<string, unknown>;
        const kind = entry.recipientKind === 'role' ? 'role' : 'assignee';

        // FR-073: the in-application transport is not optional. Accepting
        // `false` here and quietly storing `true` would make the screen lie;
        // refusing says plainly that the control is fixed.
        if (entry.inApp === false) {
          throw validationError([{ field: 'inApp', message: 'alerts.error.inAppNotOptional' }]);
        }

        if (kind === 'role' && !Number.isInteger(Number(entry.roleId))) {
          throw validationError([{ field: 'roleId', message: 'alerts.error.roleRequired' }]);
        }

        rows.push({
          event_key: eventKey,
          recipient_kind: kind,
          role_id: kind === 'role' ? Number(entry.roleId) : null,
          in_app: true,
          by_email: entry.byEmail === true,
          by_sms: entry.bySms === true,
        });
      }
    }

    await sequelize.transaction(async (transaction) => {
      await AlertSubscription.destroy({ where: {}, truncate: false, transaction });

      if (rows.length > 0) {
        await AlertSubscription.bulkCreate(rows, { transaction });
      }
    });

    res.status(200).json({ events: await alertService.listSubscriptions() });
  } catch (error) {
    next(error);
  }
}
