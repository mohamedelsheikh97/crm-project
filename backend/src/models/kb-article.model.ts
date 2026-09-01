import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export const KB_ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const;
export type KbArticleStatus = (typeof KB_ARTICLE_STATUSES)[number];

export const KB_AUDIENCES = ['internal', 'customer'] as const;
export type KbAudience = (typeof KB_AUDIENCES)[number];

/**
 * One piece of what the organisation knows (Phase 7).
 *
 * THREE DEFAULTS CARRY REQUIREMENTS:
 *
 *   status = 'draft'      — FR-004. An article is visible because somebody
 *                           published it, not because it was created. No path
 *                           in this codebase creates a published article.
 *   audience = 'internal' — the safe default for content nobody has considered
 *                           is "colleagues only" (FR-031).
 *   category_id NOT NULL  — FR-010. An article only search can reach is one
 *                           nobody can browse to.
 *
 * `slug` is null until FIRST PUBLISH and stable thereafter (research D10):
 * every link already sent stays valid when a title is corrected.
 *
 * `view_count` is A COUNTER, NEVER AN EVENT TABLE (research D11, FR-050). It
 * cannot accidentally grow an IP column the first time somebody wants a trend.
 *
 * NO DESTROY PATH (FR-007) and NO VERSION HISTORY (spec Assumptions).
 */
export class KbArticle extends Model<
  InferAttributes<KbArticle>,
  InferCreationAttributes<KbArticle>
> {
  declare id: CreationOptional<number>;
  declare category_id: number;
  /** Null until first publish. Never changed afterwards. */
  declare slug: CreationOptional<string | null>;
  declare title_en: CreationOptional<string | null>;
  declare title_ar: CreationOptional<string | null>;
  declare body_en: CreationOptional<string | null>;
  declare body_ar: CreationOptional<string | null>;
  declare status: CreationOptional<KbArticleStatus>;
  declare audience: CreationOptional<KbAudience>;
  /** Set once at first publish; NOT cleared by archiving. */
  declare published_at: CreationOptional<Date | null>;
  declare published_by_user_id: CreationOptional<number | null>;
  declare created_by_user_id: CreationOptional<number | null>;
  declare updated_by_user_id: CreationOptional<number | null>;
  declare view_count: CreationOptional<number>;
  declare version: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

function trimmedOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

KbArticle.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    category_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    slug: { type: DataTypes.STRING(180), allowNull: true },
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
    // MEDIUMTEXT: a long procedure with examples passes 64KB more easily than
    // it looks, and hitting that ceiling truncates instructions silently.
    body_en: {
      type: DataTypes.TEXT('medium'),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('body_en', trimmedOrNull(value));
      },
    },
    body_ar: {
      type: DataTypes.TEXT('medium'),
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('body_ar', trimmedOrNull(value));
      },
    },
    status: {
      type: DataTypes.ENUM(...KB_ARTICLE_STATUSES),
      allowNull: false,
      defaultValue: 'draft',
    },
    audience: {
      type: DataTypes.ENUM(...KB_AUDIENCES),
      allowNull: false,
      defaultValue: 'internal',
    },
    published_at: { type: DataTypes.DATE, allowNull: true },
    published_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    updated_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    view_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'KbArticle', tableName: 'kb_articles' },
);

export default KbArticle;
