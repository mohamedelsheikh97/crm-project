import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { TicketCategory, TicketPriority } from '../tickets/taxonomy.js';

/**
 * A service commitment (Phase 6, FR-001-FR-009).
 *
 * NO DESTROY PATH (FR-019), for the same reason customers and tickets have
 * none: a policy tickets were measured against is deactivated, never deleted,
 * so the ticket's record of what it promised stays readable. Do not add a
 * destroy method, endpoint, or interface control.
 *
 * `specificity` is DERIVED on write, never accepted from a caller — see
 * specificityOf() below and sla/precedence.ts.
 */
export class SlaPolicy extends Model<
  InferAttributes<SlaPolicy>,
  InferCreationAttributes<SlaPolicy>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  /** Set for seeded defaults so a fresh install is not English-only (FR-004). */
  declare name_ar: CreationOptional<string | null>;
  /** NULL means "any priority". */
  declare priority: CreationOptional<TicketPriority | null>;
  /** NULL means "any category". */
  declare category: CreationOptional<TicketCategory | null>;
  /** WORKING minutes (Clarifications Q1), not wall-clock. */
  declare response_minutes: number;
  declare resolution_minutes: number;
  declare is_active: CreationOptional<boolean>;
  declare specificity: CreationOptional<number>;
  declare created_by_user_id: CreationOptional<number | null>;
  declare version: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

SlaPolicy.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      set(value: string) {
        this.setDataValue('name', String(value).trim());
      },
    },
    name_ar: {
      type: DataTypes.STRING(120),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('name_ar', value === null ? null : String(value).trim() || null);
      },
    },
    priority: { type: DataTypes.STRING(20), allowNull: true },
    category: { type: DataTypes.STRING(30), allowNull: true },
    response_minutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    resolution_minutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    specificity: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'SlaPolicy',
    tableName: 'sla_policies',
    version: true,
  },
);

export default SlaPolicy;
