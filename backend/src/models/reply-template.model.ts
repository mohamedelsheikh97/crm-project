import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * A reusable body of text, offered to agents in Arabic and English.
 *
 * In this phase a template is inserted into the INTERNAL NOTE COMPOSER or
 * copied to the clipboard — nothing is sent to a customer, because no
 * customer-facing correspondence exists until Phase 5 (Clarifications Q2).
 *
 * Both language pairs are nullable, but at least one COMPLETE pair (title and
 * body) is required. That is validated with zod at the controller boundary
 * rather than in the schema, because the validator can say which half is
 * missing. FR-070's "when only one language is present, offer it with its
 * language identified" then describes a legitimate state rather than a bug
 * worked around.
 *
 * RETIREMENT, NOT DELETION (FR-071): a retired template leaves the picker and
 * changes nothing already written from it. NO DESTROY PATH.
 */
export class ReplyTemplate extends Model<
  InferAttributes<ReplyTemplate>,
  InferCreationAttributes<ReplyTemplate>
> {
  declare id: CreationOptional<number>;
  declare title_en: CreationOptional<string | null>;
  declare title_ar: CreationOptional<string | null>;
  declare body_en: CreationOptional<string | null>;
  declare body_ar: CreationOptional<string | null>;
  /** Null = offered in the picker. */
  declare retired_at: CreationOptional<Date | null>;
  declare created_by_user_id: number;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

function trimmedOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

ReplyTemplate.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    title_en: {
      type: DataTypes.STRING(160),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('title_en', trimmedOrNull(value));
      },
    },
    title_ar: {
      type: DataTypes.STRING(160),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('title_ar', trimmedOrNull(value));
      },
    },
    body_en: {
      type: DataTypes.TEXT,
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('body_en', trimmedOrNull(value));
      },
    },
    body_ar: {
      type: DataTypes.TEXT,
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('body_ar', trimmedOrNull(value));
      },
    },
    retired_at: { type: DataTypes.DATE, allowNull: true },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'ReplyTemplate', tableName: 'reply_templates' },
);

export default ReplyTemplate;
