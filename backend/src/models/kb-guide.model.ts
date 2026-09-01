import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

import type { KbAudience } from './kb-article.model.js';
import { KB_AUDIENCES } from './kb-article.model.js';

/**
 * An ordered series of articles on one subject (Phase 7, Clarifications Q2).
 *
 * A GUIDE HAS NO STATUS OF ITS OWN. FR-011d says a guide with no
 * reader-visible articles is not offered, and that is DERIVED from its steps
 * rather than stored — a stored flag would go stale the moment a step was
 * archived, and nothing would notice.
 */
export class KbGuide extends Model<InferAttributes<KbGuide>, InferCreationAttributes<KbGuide>> {
  declare id: CreationOptional<number>;
  declare title_en: CreationOptional<string | null>;
  declare title_ar: CreationOptional<string | null>;
  declare slug: string;
  declare audience: CreationOptional<KbAudience>;
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

KbGuide.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    title_en: {
      type: DataTypes.STRING(200),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('title_en', trimmedOrNull(value));
      },
    },
    title_ar: {
      type: DataTypes.STRING(200),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('title_ar', trimmedOrNull(value));
      },
    },
    slug: { type: DataTypes.STRING(180), allowNull: false },
    audience: {
      type: DataTypes.ENUM(...KB_AUDIENCES),
      allowNull: false,
      defaultValue: 'internal',
    },
    position: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'KbGuide', tableName: 'kb_guides' },
);

export default KbGuide;
