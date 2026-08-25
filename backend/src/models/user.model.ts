import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from 'sequelize';

import { sequelize } from '../config/database.js';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: number;
  declare email: string;
  declare password_hash: string;
  declare readonly created_at: Date;
  declare readonly updated_at: Date;
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
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
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
