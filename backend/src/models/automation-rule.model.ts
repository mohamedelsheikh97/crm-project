import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/** One stored condition. Validated against automation/catalog.ts on write. */
export interface RuleCondition {
  field: string;
  operator: string;
  value: unknown;
}

/** One stored action. Validated against automation/catalog.ts on write. */
export interface RuleAction {
  action: string;
  params: Record<string, unknown>;
}

/**
 * A trigger-condition-action rule (Phase 6, FR-054-FR-061).
 *
 * CONDITIONS AND ACTIONS ARE JSON, VALIDATED ON WRITE against
 * automation/catalog.ts. That is what makes FR-058's bounded authority
 * structural rather than a runtime check: a stored rule cannot name something
 * the catalog does not contain, so the executor may trust its input and a rule
 * that would misbehave fails at save time in front of its author.
 *
 * `is_enabled` DEFAULTS TO FALSE (FR-061). Saving a rule and running a rule are
 * two different acts, and the dry run (FR-066) exists to happen between them.
 *
 * `created_by_user_id` is the accountability record FR-086 attributes automated
 * acts to — captured at creation, not read from whichever session triggered it.
 */
export class AutomationRule extends Model<
  InferAttributes<AutomationRule>,
  InferCreationAttributes<AutomationRule>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare trigger_key: string;
  /** Empty array = always (FR-055). */
  declare conditions_json: CreationOptional<RuleCondition[]>;
  /** At least one (FR-055). */
  declare actions_json: RuleAction[];
  declare is_enabled: CreationOptional<boolean>;
  /** A single GLOBAL sequence (FR-060), not one per trigger. */
  declare run_order: CreationOptional<number>;
  declare created_by_user_id: CreationOptional<number | null>;
  declare version: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AutomationRule.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      set(value: string) {
        this.setDataValue('name', String(value).trim());
      },
    },
    trigger_key: { type: DataTypes.STRING(60), allowNull: false },
    conditions_json: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    actions_json: { type: DataTypes.JSON, allowNull: false },
    is_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    run_order: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'AutomationRule',
    tableName: 'automation_rules',
    version: true,
  },
);

export default AutomationRule;
