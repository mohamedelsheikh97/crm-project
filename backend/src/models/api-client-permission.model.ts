import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * A credential's authority, in the same vocabulary as a person's
 * (Phase 11, FR-015, FR-016, FR-020).
 *
 * DELIBERATELY IDENTICAL IN SHAPE TO `role_permissions`. FR-015 asks for one
 * permission vocabulary rather than a parallel "scope" system, and the reason is
 * maintenance rather than elegance: a parallel vocabulary needs every future
 * permission added in two places, and the failure mode is a scope that looks
 * granted and is not. One vocabulary also means the existing authorization
 * matrix test covers machine credentials — Phase 10 found `ai:manage` had no
 * matrix probe and that suite had been red since Phase 9.
 *
 * `permission_key` IS NOT A FOREIGN KEY, exactly as in `role_permissions`.
 * Permissions are code (`backend/src/auth/permissions.ts`), not rows; a table
 * would imply a permission could be created by inserting one.
 *
 * FR-020 IS CHECKED AT GRANT TIME, not per request. Checking per request would
 * mean a client's authority silently changing when the administrator who created
 * it changed roles — surprising, and hard to explain to the integrator whose
 * integration broke. Checked at grant time, the grant is a decision with a date
 * and an author in the audit log. The corresponding rule for FR-023: revoking a
 * person does not revoke the client, because the client's authority is its own.
 */
export class ApiClientPermission extends Model<
  InferAttributes<ApiClientPermission>,
  InferCreationAttributes<ApiClientPermission>
> {
  declare id: CreationOptional<number>;
  declare api_client_id: number;
  declare permission_key: string;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ApiClientPermission.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    api_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    permission_key: { type: DataTypes.STRING(100), allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'ApiClientPermission',
    tableName: 'api_client_permissions',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
