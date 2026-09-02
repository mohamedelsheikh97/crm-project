import type { NextFunction, Request, Response } from 'express';

import { forbidden, notFound, unauthenticated, validationError } from '../../errors/app-error.js';
import { isPermissionKey, type PermissionKey } from '../../auth/permissions.js';
import { WEBHOOK_EVENT_TYPES } from '../../models/webhook-subscription.model.js';
import * as apiClientService from '../../services/api-client.service.js';
import {
  AUDIT_ACTIONS,
  auditContextFrom,
  record as recordAudit,
} from '../../services/audit.service.js';
import { getRolePermissions } from '../../services/authorization.service.js';
import { sequelize } from '../../config/database.js';
import * as subscriptionService from '../../services/webhook-subscription.service.js';
import { ApiClient, ApiClientPermission, WebhookSubscription } from '../../models/index.js';

/**
 * Integration administration (Phase 11, US2 and US3, FR-017 - FR-022, FR-062).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A SECRET APPEARS IN EXACTLY ONE RESPONSE, EVER.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The create response. Never a list, never a detail, never an export, and there
 * is no "reveal" endpoint — FR-017 requires the system to be able to verify a
 * presented secret and unable to reveal the stored one, and for the API
 * credential that is literally true because only its SHA-256 is kept.
 *
 * A subscription's signing secret is different in kind: this system must sign
 * with it, so it is stored encrypted rather than hashed (`lib/secret-box.ts`
 * explains the asymmetry). It is therefore RECOVERABLE by the application and
 * still never returned again — an administrator who loses it rotates rather than
 * retrieves. That keeps the administration surface free of a control that would
 * echo it, which is what FR-066 is protecting.
 */

function actorFrom(req: Request) {
  if (!req.user) throw unauthenticated();

  return { id: req.user.id, email: req.user.email };
}

// ─── API clients ──────────────────────────────────────────────────────────

export async function listClients(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clients = await ApiClient.findAll({
      include: [{ model: ApiClientPermission, as: 'permissions' }],
      order: [['created_at', 'DESC']],
    });

    res.status(200).json({
      items: clients.map((client) => ({
        id: client.id,
        clientId: client.client_id,
        name: client.name,
        isActive: client.is_active,
        // FR-022: when it was last used, which is the question that precedes
        // every credential cleanup. Never the secret.
        lastUsedAt: client.last_used_at,
        createdAt: client.created_at,
        permissions: (
          (client as unknown as { permissions?: ApiClientPermission[] }).permissions ?? []
        ).map((permission) => permission.permission_key),
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = actorFrom(req);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const requested: unknown = req.body?.permissions;

    if (name === '' || name.length > 120) {
      throw validationError([{ field: 'name', message: 'a name is required' }]);
    }

    if (!Array.isArray(requested)) {
      throw validationError([{ field: 'permissions', message: 'permissions must be an array' }]);
    }

    /**
     * FR-020, checked HERE with the granting administrator's OWN permissions.
     *
     * Read fresh from their role rather than taken from the request, so an
     * administrator cannot grant a credential more authority than they hold.
     * Checked at grant time rather than per request: research D5 records why —
     * per-request checking would mean a client's authority silently changing
     * when its creator changed roles, which is impossible to explain to the
     * integrator whose integration broke.
     */
    const held = await getRolePermissions(req.user!.roleId);

    const issued = await apiClientService.issue({
      name,
      permissions: requested.map((value) => String(value)),
      createdByUserId: actor.id,
      grantableBy: held,
    });

    await sequelize.transaction(async (transaction) => {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.API_CLIENT_CREATED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'api_client',
          targetId: issued.client.id,
          targetLabel: issued.client.client_id,
          // The GRANT is recorded, never the secret (FR-021, FR-066).
          metadata: { name, permissions: requested },
          ...auditContextFrom(req),
        },
        transaction,
      );
    });

    res.status(201).json({
      id: issued.client.id,
      clientId: issued.client.client_id,
      name: issued.client.name,
      /**
       * THE ONLY TIME THIS VALUE IS EVER RETURNED.
       *
       * Named `secretShownOnce` rather than `secret` so a client library author
       * reading the response cannot mistake it for a field they can re-read.
       */
      secretShownOnce: issued.bearer,
    });
  } catch (error) {
    if (error instanceof apiClientService.UnknownPermissionError) {
      next(
        validationError(
          error.keys.map((key) => ({
            field: 'permissions',
            message: `${key} is not a permission`,
          })),
        ),
      );
      return;
    }

    if (error instanceof apiClientService.PermissionNotHeldError) {
      // 403, not 400: the request is well-formed and the administrator is not
      // allowed to make it.
      next(
        forbidden(
          error.keys.map((key) => ({ field: 'permissions', message: `you do not hold ${key}` })),
        ),
      );
      return;
    }

    next(error);
  }
}

export async function rotateClientSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) throw notFound();

    const rotated = await apiClientService.rotate(id);

    await sequelize.transaction(async (transaction) => {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.API_CLIENT_SECRET_ROTATED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'api_client',
          targetId: id,
          targetLabel: rotated.client.client_id,
          metadata: { overlapHours: rotated.overlapHours },
          ...auditContextFrom(req),
        },
        transaction,
      );
    });

    res.status(200).json({
      secretShownOnce: rotated.bearer,
      /**
       * Stated in the response because it is the one thing the administrator
       * needs to act on: they have this long to update the integration before
       * the old secret stops working.
       */
      previousSecretValidForHours: rotated.overlapHours,
    });
  } catch (error) {
    if (error instanceof apiClientService.UnknownClientError) {
      next(notFound());
      return;
    }

    next(error);
  }
}

export async function revokeClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = actorFrom(req);
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) throw notFound();

    const client = await apiClientService.revoke(id);

    await sequelize.transaction(async (transaction) => {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.API_CLIENT_REVOKED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'api_client',
          targetId: id,
          targetLabel: client.client_id,
          metadata: {},
          ...auditContextFrom(req),
        },
        transaction,
      );
    });

    res.status(204).end();
  } catch (error) {
    if (error instanceof apiClientService.UnknownClientError) {
      next(notFound());
      return;
    }

    next(error);
  }
}

// ─── Subscriptions ────────────────────────────────────────────────────────

export async function listSubscriptions(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const subscriptions = await WebhookSubscription.findAll({
      include: [{ model: ApiClient, as: 'client' }],
      order: [['created_at', 'DESC']],
    });

    res.status(200).json({
      // The event types a subscription may ask for, so the screen does not
      // hardcode a list that could drift from what the system emits.
      availableEventTypes: WEBHOOK_EVENT_TYPES,
      items: subscriptions.map((subscription) => ({
        id: subscription.id,
        url: subscription.url,
        eventTypes: subscription.event_types,
        isActive: subscription.is_active,
        /**
         * A STATE WITH A NAME, not a colour and not a boolean (FR-058, FR-064).
         *
         * The screen renders an icon and a translated label from this value; a
         * green dot cannot become the only carrier of meaning because there is a
         * word beside it by construction.
         */
        health: subscription.health,
        secretRotatedAt: subscription.secret_rotated_at,
        client: {
          id: (subscription as unknown as { client?: ApiClient }).client?.id ?? null,
          name: (subscription as unknown as { client?: ApiClient }).client?.name ?? null,
        },
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const apiClientId = Number(req.body?.apiClientId);
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const eventTypes: unknown = req.body?.eventTypes;

    if (!Number.isInteger(apiClientId)) {
      throw validationError([{ field: 'apiClientId', message: 'a credential is required' }]);
    }

    if (!Array.isArray(eventTypes)) {
      throw validationError([{ field: 'eventTypes', message: 'eventTypes must be an array' }]);
    }

    const client = await ApiClient.findByPk(apiClientId);

    if (!client) {
      throw validationError([{ field: 'apiClientId', message: 'no such credential' }]);
    }

    const created = await subscriptionService.create({
      apiClientId,
      url,
      eventTypes: eventTypes.map((value) => String(value)),
    });

    await sequelize.transaction(async (transaction) => {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.SUBSCRIPTION_CREATED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'webhook_subscription',
          targetId: created.subscription.id,
          targetLabel: created.subscription.url,
          // The ADDRESS and the events are recorded (FR-062); the signing
          // secret is not (FR-066).
          metadata: {
            url: created.subscription.url,
            eventTypes: created.subscription.event_types,
          },
          ...auditContextFrom(req),
        },
        transaction,
      );
    });

    res.status(201).json({
      id: created.subscription.id,
      url: created.subscription.url,
      eventTypes: created.subscription.event_types,
      signingSecretShownOnce: created.signingSecret,
    });
  } catch (error) {
    if (error instanceof subscriptionService.InvalidSubscriptionError) {
      /**
       * A refused ADDRESS arrives here (FR-034).
       *
       * 400 with the reason stated, because the administrator's next action
       * depends on which rule refused it: a private address is a mistake in what
       * they typed, and plain HTTP is a mistake in their receiver.
       */
      next(validationError([{ field: error.field, message: error.message }]));
      return;
    }

    next(error);
  }
}

export async function rotateSubscriptionSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) throw notFound();

    const secret = await subscriptionService.rotateSecret(id);

    await sequelize.transaction(async (transaction) => {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.SUBSCRIPTION_SECRET_ROTATED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'webhook_subscription',
          targetId: id,
          metadata: {},
          ...auditContextFrom(req),
        },
        transaction,
      );
    });

    res.status(200).json({ signingSecretShownOnce: secret });
  } catch (error) {
    if (error instanceof subscriptionService.InvalidSubscriptionError) {
      next(notFound());
      return;
    }

    next(error);
  }
}

export async function deactivateSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = actorFrom(req);
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) throw notFound();

    await subscriptionService.deactivate(id);

    await sequelize.transaction(async (transaction) => {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.SUBSCRIPTION_DEACTIVATED,
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetType: 'webhook_subscription',
          targetId: id,
          metadata: {},
          ...auditContextFrom(req),
        },
        transaction,
      );
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/**
 * The permissions an administrator may grant to a credential.
 *
 * Their OWN set, filtered to real keys — so the screen cannot offer a checkbox
 * that the create call would then refuse under FR-020. Offering an option that
 * fails on save is worse than not offering it.
 */
export async function grantablePermissions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw unauthenticated();

    const held = await getRolePermissions(req.user.roleId);

    res.status(200).json({
      permissions: [...held].filter((key): key is PermissionKey => isPermissionKey(key)).sort(),
    });
  } catch (error) {
    next(error);
  }
}
