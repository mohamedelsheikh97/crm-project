import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export type AuditOutcome = 'success' | 'failure';

/**
 * Append-only. This model exposes no update or destroy path and no route
 * accepts one — immutability is enforced by the absence of a write path rather
 * than by a check inside one (FR-035, research.md D5).
 *
 * In a shared environment, additionally grant the application's database user
 * INSERT and SELECT on this table and withhold UPDATE and DELETE.
 */
export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  declare id: CreationOptional<number>;
  declare action: string;
  declare actor_user_id: number | null;
  declare actor_email: string | null;
  declare target_type: string | null;
  declare target_id: string | null;
  declare target_label: string | null;
  declare outcome: AuditOutcome;
  declare ip_address: string | null;
  declare user_agent: string | null;
  declare previous_value: unknown | null;
  declare new_value: unknown | null;
  declare metadata: unknown | null;
  declare readonly created_at: CreationOptional<Date>;
}

AuditLog.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    action: { type: DataTypes.STRING(100), allowNull: false },
    actor_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    actor_email: { type: DataTypes.STRING(255), allowNull: true },
    target_type: { type: DataTypes.STRING(50), allowNull: true },
    target_id: { type: DataTypes.STRING(100), allowNull: true },
    target_label: { type: DataTypes.STRING(255), allowNull: true },
    outcome: { type: DataTypes.ENUM('success', 'failure'), allowNull: false },
    ip_address: { type: DataTypes.STRING(45), allowNull: true },
    user_agent: { type: DataTypes.STRING(255), allowNull: true },
    previous_value: { type: DataTypes.JSON, allowNull: true },
    new_value: { type: DataTypes.JSON, allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    created_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'AuditLog',
    tableName: 'audit_logs',
    // An append-only row is never updated, so there is no updated_at column.
    timestamps: true,
    updatedAt: false,
  },
);

export default AuditLog;
