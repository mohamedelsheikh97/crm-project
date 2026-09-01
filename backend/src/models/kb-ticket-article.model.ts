import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * An article DELIBERATELY attached to a ticket (Phase 7).
 *
 * THIS IS NOT WHERE SUGGESTIONS LIVE. Suggestions are computed on read and
 * never stored (research D5, FR-042) — a stored suggestion goes stale the
 * moment an article is archived, and nothing would notice. This table holds
 * only decisions.
 *
 * `attached_by_user_id` NULL MEANS AN AUTOMATION RULE DID IT — the Phase 5 and
 * 6 convention for a system act, and what lets the panel tell "a colleague
 * pinned this" from "a rule did".
 */
export class KbTicketArticle extends Model<
  InferAttributes<KbTicketArticle>,
  InferCreationAttributes<KbTicketArticle>
> {
  declare ticket_id: number;
  declare article_id: number;
  /** Null = an automation rule attached it. */
  declare attached_by_user_id: CreationOptional<number | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

KbTicketArticle.init(
  {
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, allowNull: false },
    article_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, allowNull: false },
    attached_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'KbTicketArticle', tableName: 'kb_ticket_articles' },
);

export default KbTicketArticle;
