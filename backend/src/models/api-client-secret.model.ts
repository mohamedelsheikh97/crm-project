import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * One secret for one credential (Phase 11, FR-017, FR-018).
 *
 * SEVERAL MAY BE VALID AT ONCE, and that is the whole reason this is a table.
 * Rotation inserts a new row and expires the outgoing one at now + overlap, so
 * an integration can be updated without a failed request. A credential nobody
 * can rotate without downtime is a credential nobody rotates.
 *
 * `secret_hash` IS SHA-256 OF 32 RANDOM BYTES, NOT BCRYPT. The bcrypt rule is
 * about passwords — low-entropy secrets a human chose, where a slow KDF defeats
 * an offline dictionary attack. A 32-byte random secret has no dictionary, and
 * bcrypt at this project's password cost would add roughly 100ms of CPU to every
 * API request. Phase 8 stores portal invitation tokens the same way. See
 * research.md D3, which exists because this is the decision most likely to be
 * challenged.
 *
 * INVARIANTS the service maintains:
 *   - at most one row per client with `expires_at IS NULL` — the current secret
 *   - authentication accepts `expires_at IS NULL OR expires_at > NOW()`
 *   - a row is never updated to hold a different hash; rotation inserts
 */
export class ApiClientSecret extends Model<
  InferAttributes<ApiClientSecret>,
  InferCreationAttributes<ApiClientSecret>
> {
  declare id: CreationOptional<number>;
  declare api_client_id: number;
  declare secret_hash: string;
  /** NULL means current. Set to now + overlap when rotated out. */
  declare expires_at: CreationOptional<Date | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ApiClientSecret.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    api_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    secret_hash: { type: DataTypes.CHAR(64), allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'ApiClientSecret',
    tableName: 'api_client_secrets',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
