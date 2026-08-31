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
  /**
   * TRUE means the SYSTEM created this record from an unrecognised sender and
   * nobody has confirmed who it is (Phase 5, Clarifications Q2, FR-014b).
   *
   * A flag rather than a second table, so the Phase 4 queue, the context panel,
   * the timeline and every existing query keep working untouched — only the
   * places that must distinguish look at it.
   *
   * This is what makes `customers` the first table the outside world can cause
   * rows in. The defence is FR-020 and the per-channel intake rate limit, not
   * this column. Phase 10's reporting must not count a provisional customer as
   * one somebody onboarded.
   */
  declare is_provisional: CreationOptional<boolean>;
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
    is_provisional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
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
