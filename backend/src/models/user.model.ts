import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>;
  declare email: string;
  declare full_name: string;
  /**
   * Where an SMS alert reaches this user (Phase 6, FR-072, FR-077).
   *
   * NOT A PROFILE FIELD, and the name says so. It is never shown to a customer
   * and is not the beginning of a contact directory — Phase 12 should not
   * inherit it as one. It exists because FR-077 requires a recipient with no
   * reachable address to be SKIPPED, and a user record with no number at all is
   * unreachable, which is a different and worse thing.
   *
   * Normalised through lib/phone.ts on write, the same helper Phase 2 uses for
   * customer contacts.
   */
  declare alert_phone: CreationOptional<string | null>;
  declare password_hash: string;
  declare role_id: number;
  declare is_active: CreationOptional<boolean>;
  declare must_change_password: CreationOptional<boolean>;
  declare failed_login_attempts: CreationOptional<number>;
  declare locked_until: Date | null;
  declare version: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;

  /**
   * Derived, not stored: lockout is "is locked_until in the future", so there
   * is no second field to keep in sync.
   */
  get isLocked(): NonAttribute<boolean> {
    return this.locked_until !== null && this.locked_until.getTime() > Date.now();
  }
}

User.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      set(value: string) {
        // Normalise on write so 'A@x.com' and 'a@x.com' cannot coexist; without
        // this the unique index is case-sensitively bypassable (data-model.md).
        this.setDataValue('email', String(value).trim().toLowerCase());
      },
    },
    full_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      set(value: string) {
        this.setDataValue('full_name', String(value).trim());
      },
    },
    alert_phone: { type: DataTypes.STRING(32), allowNull: true },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    role_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    must_change_password: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    failed_login_attempts: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    locked_until: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    version: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    // Optimistic locking: a stale write affects zero rows and raises
    // OptimisticLockError rather than silently overwriting (research.md D11).
    version: true,
    // Excluding password_hash by default means forgetting to exclude it is not
    // the failure mode. Reading it takes the explicit `withPassword` scope,
    // used in exactly one place (auth.service login).
    defaultScope: {
      attributes: { exclude: ['password_hash'] },
    },
    scopes: {
      withPassword: {
        attributes: { include: ['password_hash'] },
      },
    },
  },
);

export default User;
