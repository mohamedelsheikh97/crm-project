import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export type KbTermLang = 'en' | 'ar';
export type KbTermField = 'title' | 'body';

/**
 * One normalised token of one published article (Phase 7, research D1).
 *
 * `term` is ALWAYS the output of `lib/text-normalise.ts` and never raw text.
 * The same function produces these rows and parses a query — that is the whole
 * of why they meet (research D2). Any code that writes a term here without
 * going through the tokenizer has produced a word findable by nobody, and the
 * failure is invisible to any reviewer who does not read Arabic.
 *
 * ONLY PUBLISHED ARTICLES HAVE ROWS HERE (research D4). Drafting writes none;
 * archiving deletes them. FR-004 and FR-018 are therefore structural: there is
 * nothing to filter at query time because there is nothing to find.
 */
export class KbArticleTerm extends Model<
  InferAttributes<KbArticleTerm>,
  InferCreationAttributes<KbArticleTerm>
> {
  declare article_id: number;
  declare lang: KbTermLang;
  declare field: KbTermField;
  declare term: string;
  declare hits: CreationOptional<number>;
}

KbArticleTerm.init(
  {
    article_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, allowNull: false },
    lang: { type: DataTypes.ENUM('en', 'ar'), primaryKey: true, allowNull: false },
    field: { type: DataTypes.ENUM('title', 'body'), primaryKey: true, allowNull: false },
    term: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
    hits: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
  },
  {
    sequelize,
    modelName: 'KbArticleTerm',
    tableName: 'kb_article_terms',
    // No id, and no timestamps: this is an index, rebuilt wholesale on every
    // write. "When was this token written" is a question about the article.
    timestamps: false,
  },
);

export default KbArticleTerm;
