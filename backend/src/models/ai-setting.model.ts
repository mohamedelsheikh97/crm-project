import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * Single-row runtime AI configuration (Phase 9, US6).
 *
 * The same shape as Phase 6's `AssignmentSetting`: the service reads and creates
 * exactly one. See the migration for why this is a table rather than the
 * environment, and for the three fields that must never be added to it.
 */
export class AiSetting extends Model<
  InferAttributes<AiSetting>,
  InferCreationAttributes<AiSetting>
> {
  declare id: CreationOptional<number>;
  declare summary_enabled: CreationOptional<boolean>;
  declare draft_enabled: CreationOptional<boolean>;
  declare classify_enabled: CreationOptional<boolean>;
  declare similar_enabled: CreationOptional<boolean>;
  declare assistant_enabled: CreationOptional<boolean>;
  declare ceiling_summary: CreationOptional<number>;
  declare ceiling_draft: CreationOptional<number>;
  declare ceiling_classify: CreationOptional<number>;
  declare ceiling_assistant: CreationOptional<number>;
  declare assistant_langs: CreationOptional<string>;
  declare grounding_floor: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AiSetting.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    summary_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    draft_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    classify_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    similar_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    assistant_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ceiling_summary: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 500 },
    ceiling_draft: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 500 },
    ceiling_classify: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 2000 },
    ceiling_assistant: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 2000 },
    assistant_langs: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'en' },
    grounding_floor: {
      type: DataTypes.DECIMAL(4, 3),
      allowNull: false,
      defaultValue: 0.35,
      // MySQL returns DECIMAL as a string; every caller compares it to a score.
      get(): number {
        return Number(this.getDataValue('grounding_floor'));
      },
    },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'AiSetting',
    tableName: 'ai_settings',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
