import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * The grant side of the permission model. The catalog itself lives in code
 * (backend/src/auth/permissions.ts) — a row whose permission_key is not in the
 * catalog grants nothing (research.md D2).
 */
export class RolePermission extends Model<
  InferAttributes<RolePermission>,
  InferCreationAttributes<RolePermission>
> {
  declare id: number;
  declare role_id: number;
  declare permission_key: string;
  declare readonly created_at: Date;
  declare readonly updated_at: Date;
}

RolePermission.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    role_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    permission_key: { type: DataTypes.STRING(100), allowNull: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'RolePermission',
    tableName: 'role_permissions',
    indexes: [{ unique: true, fields: ['role_id', 'permission_key'] }],
  },
);

export default RolePermission;
