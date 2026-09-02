import { Op } from 'sequelize';

import { env } from '../config/env.js';
import { newSigningSecret } from '../integrations/signing.js';
import { AddressNotPermittedError, assertPubliclyRoutable } from '../lib/net-address.js';
import { open, seal, SealedValueError } from '../lib/secret-box.js';
import { WebhookDeliveryAttempt } from '../models/webhook-delivery-attempt.model.js';
import {
  isWebhookEventType,
  WebhookSubscription,
  type SubscriptionHealth,
  type WebhookEventType,
} from '../models/webhook-subscription.model.js';

/**
 * Subscriptions (Phase 11, US2 and US6, FR-025, FR-034, FR-038, FR-058).
 *
 * A subscription belongs to an API CREDENTIAL, not to a user, and that is
 * load-bearing rather than tidy: FR-037 forbids delivering an event to a
 * subscriber whose credential does not cover the record, because the
 * notification itself discloses that the record exists. Hanging it off the
 * credential is what makes that checkable at delivery time.
 *
 * THE SIGNING SECRET IS ENCRYPTED, NOT HASHED, and that asymmetry is the one
 * thing worth reading `lib/secret-box.ts` for: every other secret in this
 * project is a digest because somebody else holds it and we only verify, whereas
 * here WE sign and the subscriber verifies, so HMAC needs the key material.
 */

export class InvalidSubscriptionError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidSubscriptionError';
  }
}

export interface CreateSubscriptionInput {
  readonly apiClientId: number;
  readonly url: string;
  readonly eventTypes: readonly string[];
}

export interface CreatedSubscription {
  readonly subscription: WebhookSubscription;
  /**
   * SHOWN ONCE, in this return value.
   *
   * It is recoverable from the database by this system (that is the whole point
   * — it has to sign with it), but it is never returned again through any
   * surface. An administrator who loses it rotates rather than retrieves, which
   * keeps the administration screens free of a control that would echo it.
   */
  readonly signingSecret: string;
}

/**
 * Registers a subscription.
 *
 * THE ADDRESS IS CHECKED HERE AND AGAIN AT DELIVERY (FR-034). Checking only
 * here would miss a hostname repointed at a private address afterwards — DNS
 * rebinding — and checking only at delivery would let an administrator save an
 * address that could never work, then wonder why nothing arrives.
 */
export async function create(input: CreateSubscriptionInput): Promise<CreatedSubscription> {
  try {
    assertPubliclyRoutable(input.url, 'url');
  } catch (error) {
    throw new InvalidSubscriptionError(
      'url',
      error instanceof AddressNotPermittedError ? error.message : 'url is not usable',
    );
  }

  const types = [...new Set(input.eventTypes)];
  const unknown = types.filter((type) => !isWebhookEventType(type));

  if (unknown.length > 0) {
    /**
     * Refused rather than stored and ignored.
     *
     * A subscription holding an event type nothing emits looks to its owner like
     * a subscription that has stopped working — the same reasoning Phase 10
     * applied to unknown dashboard figure keys.
     */
    throw new InvalidSubscriptionError('event_types', `not event types: ${unknown.join(', ')}`);
  }

  if (types.length === 0) {
    throw new InvalidSubscriptionError(
      'event_types',
      'a subscription must name at least one event',
    );
  }

  const signingSecret = newSigningSecret();

  const subscription = await WebhookSubscription.create({
    api_client_id: input.apiClientId,
    url: input.url,
    event_types: types as WebhookEventType[],
    signing_secret_sealed: seal(signingSecret),
  } as never);

  return { subscription, signingSecret };
}

/**
 * Rotates the signing secret, keeping the previous one valid for the overlap.
 *
 * The overlap is what makes rotation non-disruptive (FR-038): a receiver cannot
 * atomically redeploy in step with us, so both signatures are sent until the
 * window closes. A rotation that dropped notifications in between would be an
 * outage, and a secret nobody can rotate without one is a secret nobody rotates.
 */
export async function rotateSecret(id: number): Promise<string> {
  const subscription = await WebhookSubscription.findByPk(id);

  if (!subscription) throw new InvalidSubscriptionError('id', 'no such subscription');

  const next = newSigningSecret();

  await subscription.update({
    previous_signing_secret_sealed: subscription.signing_secret_sealed,
    signing_secret_sealed: seal(next),
    secret_rotated_at: new Date(),
  });

  return next;
}

/**
 * The secrets to sign with, newest first.
 *
 * Returns TWO during a rotation overlap so the header carries two `v1=` values
 * and a receiver can accept either while it redeploys.
 *
 * A SEALED VALUE THAT WILL NOT OPEN IS A VISIBLE FAILURE, not a silent one. It
 * means `WEBHOOK_SIGNING_KEY` changed, and the honest response is for delivery
 * to fail with a reason an administrator can act on — rotate the subscription's
 * secret — rather than sending an unsigned or wrongly-signed payload that a
 * receiver would reject without explanation.
 */
export function signingSecretsFor(subscription: WebhookSubscription): string[] {
  const secrets: string[] = [open(subscription.signing_secret_sealed)];

  const overlapMs = env.CREDENTIAL_ROTATION_OVERLAP_HOURS * 3_600_000;
  const rotatedAt = subscription.secret_rotated_at;

  const withinOverlap =
    subscription.previous_signing_secret_sealed !== null &&
    rotatedAt !== null &&
    Date.now() - rotatedAt.getTime() < overlapMs;

  if (withinOverlap && subscription.previous_signing_secret_sealed) {
    try {
      secrets.push(open(subscription.previous_signing_secret_sealed));
    } catch (error) {
      /**
       * The PREVIOUS secret failing to open is survivable — the current one is
       * what most receivers are already using — so it is swallowed rather than
       * failing the delivery. The current one failing is not, and propagates.
       */
      if (!(error instanceof SealedValueError)) throw error;
    }
  }

  return secrets;
}

/** Active subscriptions wanting this event type. */
export async function subscribersFor(eventType: WebhookEventType): Promise<WebhookSubscription[]> {
  const active = await WebhookSubscription.findAll({ where: { is_active: true } });

  /**
   * Filtered in application code rather than with a JSON query.
   *
   * MySQL can query a JSON array, but the expression differs across versions and
   * cannot use an index either way. Subscriptions are a handful of rows per
   * deployment — a table an administrator maintains by hand — so a full read and
   * a filter is both simpler and honest about the cardinality.
   */
  return active.filter((subscription) => subscription.event_types.includes(eventType));
}

/**
 * Derives health from recent attempts and stores it (FR-058, US6).
 *
 * DERIVED AND STORED rather than computed per render, so the overview reads a
 * value. Stored as an ENUM rather than a boolean, so the label is translatable
 * text beside an icon — FR-064 forbids conveying health by colour alone, and a
 * state with a name makes that structural rather than a rendering convention.
 */
export async function refreshHealth(subscriptionId: number): Promise<SubscriptionHealth> {
  const recent = await WebhookDeliveryAttempt.findAll({
    where: {
      subscription_id: subscriptionId,
      state: { [Op.in]: ['succeeded', 'failed', 'abandoned'] },
    },
    order: [['created_at', 'DESC']],
    limit: 10,
  });

  let health: SubscriptionHealth;

  if (recent.length === 0) {
    // Never attempted. NOT "healthy" — that would claim something unverified,
    // and a brand-new subscription showing green is how a misconfigured address
    // goes unnoticed until somebody asks why nothing arrived.
    health = 'unknown';
  } else {
    const failures = recent.filter((attempt) => attempt.state !== 'succeeded').length;

    if (failures === 0) health = 'healthy';
    else if (failures === recent.length) health = 'failing';
    else health = 'degraded';
  }

  await WebhookSubscription.update({ health }, { where: { id: subscriptionId } });

  return health;
}

export async function deactivate(id: number): Promise<void> {
  await WebhookSubscription.update({ is_active: false }, { where: { id } });
}
