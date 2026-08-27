import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * Supports the reuse check and nothing more (FR-023). No endpoint returns any
 * part of this table; the defaultScope excluding password_hash mirrors the
 * pattern user.model.ts established in Phase 0, so forgetting to exclude it is
 * not the failure mode.
 */
export class PasswordHistory extends Model<
  InferAttributes<PasswordHistory>,
  InferCreationAttributes<PasswordHistory>
> {
  declare id: CreationOptional<number>;
  declare user_id: number;
  declare password_hash: string;
  declare readonly created_at: CreationOptional<Date>;
}

PasswordHistory.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    created_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'PasswordHistory',
    tableName: 'password_history',
    timestamps: true,
    updatedAt: false,
    defaultScope: { attributes: { exclude: ['password_hash'] } },
    scopes: { withHash: { attributes: { include: ['password_hash'] } } },
  },
);

export default PasswordHistory;
