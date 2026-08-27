import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { ContactKind } from '../lib/phone.js';

/**
 * A record that someone was warned about a duplicate and decided anyway.
 *
 * One row per match: being warned about three existing customers and proceeding
 * writes three rows, so the record of what was shown is complete rather than
 * summarised. FR-020 and SC-005 require this decision to be retrievable months
 * later, which an audit entry alone would not achieve — it records that a save
 * happened with acknowledgement, not which records were on screen.
 */
export class DuplicateOverride extends Model<
  InferAttributes<DuplicateOverride>,
  InferCreationAttributes<DuplicateOverride>
> {
  declare id: CreationOptional<number>;
  declare customer_id: number;
  declare matched_customer_id: number;
  declare decided_by_user_id: number;
  declare matched_on: ContactKind;
  declare matched_value: string;
  declare readonly created_at: CreationOptional<Date>;
}

DuplicateOverride.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    matched_customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    decided_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    matched_on: { type: DataTypes.ENUM('phone', 'email'), allowNull: false },
    matched_value: { type: DataTypes.STRING(255), allowNull: false },
    created_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'DuplicateOverride',
    tableName: 'customer_duplicate_overrides',
    timestamps: true,
    updatedAt: false,
  },
);

export default DuplicateOverride;
