import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export const ALERT_TRANSPORTS = ['in_app', 'email', 'sms'] as const;

export type AlertTransport = (typeof ALERT_TRANSPORTS)[number];

/**
 * FOUR OUTCOMES, AND THE DISTINCTION BETWEEN THEM IS THE REQUIREMENT (FR-076).
 *
 *   delivered  — it went.
 *   skipped    — no reachable address for this transport (FR-077). Not a
 *                failure: there was nothing to try.
 *   suppressed — the FR-078 ceiling stopped it. We chose not to send.
 *   failed     — the transport refused it. We tried and could not.
 *
 * Collapsing these to a boolean makes an unreachable recipient
 * indistinguishable from a broken gateway — precisely the diagnosis someone
 * needs at 03:00 when an escalation went unanswered.
 */
export const DELIVERY_OUTCOMES = ['delivered', 'skipped', 'suppressed', 'failed'] as const;

export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

/**
 * One attempt to reach one recipient over one transport (Phase 6, FR-076).
 *
 * An alert to a USER writes a row here and NO `messages` row (research D13):
 * `messages` is customer correspondence, kept free of internal content by
 * Phase 5 Clarifications Q3 so Phase 8 can safely build a customer-facing view
 * on it. Operational traffic to agents must not enter it.
 */
export class AlertDelivery extends Model<
  InferAttributes<AlertDelivery>,
  InferCreationAttributes<AlertDelivery>
> {
  declare id: CreationOptional<number>;
  declare event_key: string;
  declare ticket_id: CreationOptional<number | null>;
  /** Null when the recipient was a customer. */
  declare user_id: CreationOptional<number | null>;
  declare customer_id: CreationOptional<number | null>;
  declare transport: AlertTransport;
  declare outcome: DeliveryOutcome;
  /** The transport's own reason. Never a credential. */
  declare detail: CreationOptional<string | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AlertDelivery.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    event_key: { type: DataTypes.STRING(60), allowNull: false },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    transport: { type: DataTypes.STRING(20), allowNull: false },
    outcome: { type: DataTypes.STRING(20), allowNull: false },
    detail: { type: DataTypes.STRING(255), allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'AlertDelivery',
    tableName: 'alert_deliveries',
  },
);

export default AlertDelivery;
