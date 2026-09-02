import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/** The lifecycle points a subscriber may ask for (FR-024). */
export const WEBHOOK_EVENT_TYPES = [
  'ticket.created',
  'ticket.resolved',
  'customer.created',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === 'string' && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Subscription health, DERIVED FROM RECENT ATTEMPTS AND STORED.
 *
 * A state with a name, not a colour and not a boolean. FR-058 wants an
 * administrator to see health without inferring it from a list of failures, and
 * FR-064 forbids conveying it by colour alone — so the label is translated text
 * and the icon is chosen from the value. A green dot cannot become the only
 * carrier of meaning, because there is a word beside it by construction.
 */
export const SUBSCRIPTION_HEALTH = ['healthy', 'degraded', 'failing', 'unknown'] as const;

export type SubscriptionHealth = (typeof SUBSCRIPTION_HEALTH)[number];

/**
 * Where notifications go (Phase 11, FR-024 - FR-038).
 *
 * IT BELONGS TO AN `api_client`, NOT TO A USER. FR-037 forbids delivering an
 * event to a subscriber whose credential does not cover the record, because the
 * notification itself discloses that the record exists — "ticket 421 was
 * resolved" tells the receiver there is a ticket 421. Hanging the subscription
 * off the credential is what makes that checkable at delivery time.
 *
 * TWO SECRET COLUMNS rather than a table, unlike the credential's secrets: a
 * subscription's signature only ever needs "current and one previous", so a
 * table would be more machinery than the requirement asks for.
 */
export class WebhookSubscription extends Model<
  InferAttributes<WebhookSubscription>,
  InferCreationAttributes<WebhookSubscription>
> {
  declare id: CreationOptional<number>;
  declare api_client_id: number;
  declare url: string;
  declare event_types: WebhookEventType[];
  /**
   * The signing secret, ENCRYPTED (`lib/secret-box.ts`) rather than hashed.
   *
   * Every other secret in this project is a one-way hash, because somebody else
   * holds it and this system only verifies. This one is the reverse: WE sign and
   * the subscriber verifies, so HMAC needs the key material and a digest cannot
   * serve. Migration 20260904000009 records the correction and why.
   */
  declare signing_secret_sealed: string;
  /** Accepted during a rotation overlap, so a receiver can redeploy (FR-038). */
  declare previous_signing_secret_sealed: CreationOptional<string | null>;
  declare secret_rotated_at: CreationOptional<Date | null>;
  declare is_active: CreationOptional<boolean>;
  declare health: CreationOptional<SubscriptionHealth>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

WebhookSubscription.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    api_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    url: { type: DataTypes.STRING(2048), allowNull: false },
    event_types: { type: DataTypes.JSON, allowNull: false },
    signing_secret_sealed: { type: DataTypes.STRING(512), allowNull: false },
    previous_signing_secret_sealed: { type: DataTypes.STRING(512), allowNull: true },
    secret_rotated_at: { type: DataTypes.DATE, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    health: {
      type: DataTypes.ENUM(...SUBSCRIPTION_HEALTH),
      allowNull: false,
      defaultValue: 'unknown',
    },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'WebhookSubscription',
    tableName: 'webhook_subscriptions',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
