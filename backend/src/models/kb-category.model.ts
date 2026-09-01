import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * The knowledge base's own filing structure (Phase 7, Clarifications Q2).
 *
 * SEPARATE FROM PHASE 3's TICKET CATEGORIES. A ticket category describes what
 * somebody asked about; this describes how the organisation files what it
 * knows. `ticket_category` below is the stated relationship between the two
 * (FR-040, research D6) — a BOOST when suggesting, never a filter, because a
 * technical article can be the right answer to a billing ticket.
 *
 * FLAT, NOT A TREE (spec Assumptions). No `parent_id`, deliberately.
 *
 * Names are per-language DATA rather than i18n keys (FR-012): an administrator
 * creates a category at runtime and cannot add a key to a locale file.
 */
export class KbCategory extends Model<
  InferAttributes<KbCategory>,
  InferCreationAttributes<KbCategory>
> {
  declare id: CreationOptional<number>;
  declare name_en: CreationOptional<string | null>;
  declare name_ar: CreationOptional<string | null>;
  declare slug: string;
  /** Null means "relates to no particular ticket category" — the honest answer. */
  declare ticket_category: CreationOptional<string | null>;
  declare position: CreationOptional<number>;
  declare version: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

function trimmedOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

KbCategory.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    name_en: {
      type: DataTypes.STRING(120),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('name_en', trimmedOrNull(value));
      },
    },
    name_ar: {
      type: DataTypes.STRING(120),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('name_ar', trimmedOrNull(value));
      },
    },
    slug: { type: DataTypes.STRING(140), allowNull: false },
    ticket_category: { type: DataTypes.STRING(30), allowNull: true },
    position: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'KbCategory', tableName: 'kb_categories' },
);

export default KbCategory;
