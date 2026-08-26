import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from 'sequelize';

import { sequelize } from '../config/database.js';

export type RoleKey = 'agent' | 'supervisor' | 'admin';

/**
 * Exactly three rows, inserted by the create-roles migration and permanent
 * (FR-021). No create or destroy helper is exposed here, and no endpoint offers
 * one — the role set is fixed.
 */
export class Role extends Model<InferAttributes<Role>, InferCreationAttributes<Role>> {
  declare id: number;
  declare key: RoleKey;
  declare name_key: string;
  declare description_key: string;
  declare readonly created_at: Date;
  declare readonly updated_at: Date;
}

Role.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    key: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    name_key: { type: DataTypes.STRING(100), allowNull: false },
    description_key: { type: DataTypes.STRING(100), allowNull: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'Role', tableName: 'roles' },
);

export default Role;
