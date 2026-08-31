import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * How unassigned work is distributed (Phase 6, FR-043-FR-047).
 *
 * `'off'` IS A STRATEGY, NOT AN ABSENCE. FR-043 requires turning automatic
 * assignment off entirely, and a member of the union cannot be forgotten by a
 * caller the way a null check can.
 */
export const ASSIGNMENT_STRATEGIES = ['off', 'round_robin', 'least_loaded', 'competency'] as const;

export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

const STRATEGY_SET: ReadonlySet<string> = new Set(ASSIGNMENT_STRATEGIES);

export function isAssignmentStrategy(value: unknown): value is AssignmentStrategy {
  return typeof value === 'string' && STRATEGY_SET.has(value);
}

/** Single-row configuration. The service reads and creates exactly one. */
export class AssignmentSetting extends Model<
  InferAttributes<AssignmentSetting>,
  InferCreationAttributes<AssignmentSetting>
> {
  declare id: CreationOptional<number>;
  declare strategy: CreationOptional<AssignmentStrategy>;
  /** NULL = no ceiling (FR-047). Not 0, which means something else entirely. */
  declare max_open_per_agent: CreationOptional<number | null>;
  /**
   * STORED, not derived (research D12). "The assignee of the most recent
   * auto-assigned ticket" breaks on reassignment and merge, and FR-046 requires
   * two runs on identical state to produce identical results.
   */
  declare round_robin_cursor_user_id: CreationOptional<number | null>;
  declare updated_by_user_id: CreationOptional<number | null>;
  declare version: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AssignmentSetting.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    strategy: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'off' },
    max_open_per_agent: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
    round_robin_cursor_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    updated_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'AssignmentSetting',
    tableName: 'assignment_settings',
    version: true,
  },
);

export default AssignmentSetting;
