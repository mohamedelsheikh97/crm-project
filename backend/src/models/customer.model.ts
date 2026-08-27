import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * The record every later module attaches to.
 *
 * NO DESTROY PATH. Deactivation is the only removal (Clarifications Q1), which
 * is what lets Phase 3 treat a customer reference as permanent. Do not add a
 * delete method, endpoint, or interface control.
 */
export class Customer extends Model<InferAttributes<Customer>, InferCreationAttributes<Customer>> {
  declare id: CreationOptional<number>;
  declare display_name: string;
  declare company: string | null;
  declare address: string | null;
  declare is_active: CreationOptional<boolean>;
  declare created_by_user_id: number | null;
  declare version: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

Customer.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    display_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      set(value: string) {
        this.setDataValue('display_name', String(value).trim());
      },
    },
    company: {
      type: DataTypes.STRING(255),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('company', value === null ? null : String(value).trim() || null);
      },
    },
    address: { type: DataTypes.TEXT, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'Customer',
    tableName: 'customers',
    // Optimistic locking, as users established (FR-045).
    version: true,
  },
);

export default Customer;
