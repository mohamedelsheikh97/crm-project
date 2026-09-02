import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * A named external system permitted to reach the published interface
 * (Phase 11, FR-014 - FR-023).
 *
 * NO SECRET FIELD, AND THERE CANNOT BE ONE. Secrets are rows in
 * `api_client_secrets` so that rotation is data rather than a schema concern —
 * FR-018 requires the outgoing and incoming secrets to be valid at the same
 * time, because an integrator cannot atomically redeploy in step with our
 * update.
 *
 * `client_id` is the PUBLIC half. It travels in every request and appears in
 * audit records, and it is prefixed so an administrator can match a leaked
 * credential's visible half to a record without ever holding the secret.
 */
export class ApiClient extends Model<
  InferAttributes<ApiClient>,
  InferCreationAttributes<ApiClient>
> {
  declare id: CreationOptional<number>;
  declare client_id: string;
  declare name: string;
  declare is_active: CreationOptional<boolean>;
  declare created_by_user_id: number | null;
  /** FR-022. Written on successful authentication, so a read path writes. */
  declare last_used_at: CreationOptional<Date | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ApiClient.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    client_id: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    last_used_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'ApiClient',
    tableName: 'api_clients',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
