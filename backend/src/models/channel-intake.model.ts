import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { Channel } from './message.model.js';

/**
 * What became of an accepted delivery.
 *
 * `IGNORED` IS NOT `FAILED`, and the distinction earns its place. An
 * out-of-office reply was recognised and deliberately not converted (FR-029) —
 * that is a correct outcome, not an error. Collapsing the two would fill an
 * administrator's failure review with correctly-handled automated mail, and the
 * genuine failures, the ones a customer is waiting on, would be lost in it.
 *
 * `CONVERTED` is terminal. Reprocessing one would duplicate a ticket, which is
 * precisely what this table exists to prevent.
 */
export const INTAKE_STATUSES = {
  PENDING: 'pending',
  CONVERTED: 'converted',
  IGNORED: 'ignored',
  FAILED: 'failed',
} as const;

export type IntakeStatus = (typeof INTAKE_STATUSES)[keyof typeof INTAKE_STATUSES];

/**
 * THE INTAKE LEDGER (research.md D13). One row per accepted delivery, written
 * BEFORE conversion is attempted.
 *
 * Three requirements that look separate are all this one table:
 *
 *   - idempotency (FR-007, FR-039, FR-055, FR-094) — the unique index on
 *     `(channel, provider_message_id)`. Every channel gets it; none implements
 *     its own.
 *   - nothing is lost (FR-037, FR-038) — `raw_payload` with `status` and
 *     `reason`, so a delivery that could not be converted is still here, still
 *     has what arrived, and can be processed again once the cause is fixed.
 *   - the intake audit trail (FR-101) — a query over it.
 */
export class ChannelIntake extends Model<
  InferAttributes<ChannelIntake>,
  InferCreationAttributes<ChannelIntake>
> {
  declare id: CreationOptional<number>;
  declare channel: Channel;
  /** The provider's own identifier. The idempotency key. */
  declare provider_message_id: string;
  declare received_at: Date;
  declare status: CreationOptional<IntakeStatus>;
  /** Human-readable. Why it was ignored, or how it failed. */
  declare reason: CreationOptional<string | null>;
  /** What actually arrived. Retained even on success, so a bug is diagnosable. */
  declare raw_payload: string;
  declare message_id: CreationOptional<number | null>;
  declare attempts: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ChannelIntake.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    channel: { type: DataTypes.STRING(20), allowNull: false },
    provider_message_id: { type: DataTypes.STRING(255), allowNull: false },
    received_at: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
    reason: { type: DataTypes.STRING(500), allowNull: true },
    raw_payload: { type: DataTypes.TEXT('medium'), allowNull: false },
    message_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'ChannelIntake', tableName: 'channel_intake' },
);

export default ChannelIntake;
