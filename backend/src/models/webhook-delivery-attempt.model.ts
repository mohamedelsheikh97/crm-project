import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export const ATTEMPT_STATES = ['pending', 'succeeded', 'failed', 'abandoned'] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

/**
 * One attempt to hand an event to a subscription
 * (Phase 11, FR-030, FR-033, FR-059, FR-060).
 *
 * ATTEMPTS ARE ROWS, NOT A COUNTER ON THE EVENT. A counter answers "how many
 * times did we try?"; rows answer "what happened each time, and why?" — the
 * question FR-060 requires an administrator to be able to act on. "Delivery
 * failed 6 times" is not actionable; "TLS certificate expired" is.
 *
 * THE INVARIANT: a `pending` row always has `next_attempt_at`; a terminal row
 * never does. That is what makes the sweep's query a single index range on
 * `(state, next_attempt_at)` rather than a scan with conditions.
 *
 * `abandoned` MEANS EXHAUSTED, AND THE ROW IS KEPT (FR-033). Nothing here is
 * deleted when delivery gives up — an event that vanished at that moment is the
 * failure nobody notices, and making it visible is the whole of User Story 6.
 *
 * `resent_by_user_id` DISTINGUISHES A RE-SEND FROM A RETRY. Both produce an
 * attempt; only one is somebody's decision, and FR-059 requires that to be
 * attributable.
 */
export class WebhookDeliveryAttempt extends Model<
  InferAttributes<WebhookDeliveryAttempt>,
  InferCreationAttributes<WebhookDeliveryAttempt>
> {
  declare id: CreationOptional<number>;
  declare event_id: number;
  declare subscription_id: number;
  declare attempt_number: CreationOptional<number>;
  declare state: CreationOptional<AttemptState>;
  declare next_attempt_at: CreationOptional<Date | null>;
  declare response_status: CreationOptional<number | null>;
  /** A phrase for a human, distinct from the status code (FR-060). */
  declare failure_reason: CreationOptional<string | null>;
  declare resent_by_user_id: CreationOptional<number | null>;
  declare attempted_at: CreationOptional<Date | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

WebhookDeliveryAttempt.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    event_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    subscription_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    attempt_number: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
    state: {
      type: DataTypes.ENUM(...ATTEMPT_STATES),
      allowNull: false,
      defaultValue: 'pending',
    },
    next_attempt_at: { type: DataTypes.DATE, allowNull: true },
    response_status: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
    failure_reason: { type: DataTypes.STRING(255), allowNull: true },
    resent_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    attempted_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'WebhookDeliveryAttempt',
    tableName: 'webhook_delivery_attempts',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
