import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * One user's dashboard layout (Phase 10, FR-040).
 *
 * The only thing this phase writes to besides an audit entry. Everything else
 * in Phase 10 is read-only (FR-064), and `backend/tests/reports/read-only.test.ts`
 * asserts it.
 *
 * `layout` is an ordered list of FIGURE KEYS. See the migration for why it holds
 * nothing else — a layout that could carry filters or thresholds would be a
 * report definition, and a figure whose meaning varies per user is unauditable.
 */
export class DashboardArrangement extends Model<
  InferAttributes<DashboardArrangement>,
  InferCreationAttributes<DashboardArrangement>
> {
  declare id: CreationOptional<number>;
  declare user_id: number;
  declare layout: string[];
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

DashboardArrangement.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
    layout: { type: DataTypes.JSON, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'DashboardArrangement',
    tableName: 'dashboard_arrangements',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
