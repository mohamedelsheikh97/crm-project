import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * One turn of a customer-to-bot exchange (Phase 9, research.md D6).
 *
 * STORES TEXT, unlike everything else this phase records. It is retained
 * because it is what the organisation SAID TO A CUSTOMER (FR-043, FR-065a), on
 * the same basis Phase 5 retains outbound messages — not because AI produced
 * it. See the migration for the full reconciliation with FR-065.
 *
 * NOT a `messages` row and must never be merged with them: the Phase 5 timeline
 * stays correspondence-only, and Phase 8's customer view depends on that.
 */
export class AssistantMessage extends Model<
  InferAttributes<AssistantMessage>,
  InferCreationAttributes<AssistantMessage>
> {
  declare id: CreationOptional<number>;
  declare conversation_id: number;
  declare role: 'customer' | 'assistant';
  declare body: string;
  /**
   * Display provenance for a message already sent (FR-016) — a JSON id list
   * rather than a join, so archiving an article cannot rewrite what the bot
   * said at the time.
   */
  declare cited_article_ids: CreationOptional<number[] | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AssistantMessage.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    conversation_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    role: { type: DataTypes.ENUM('customer', 'assistant'), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    cited_article_ids: { type: DataTypes.JSON, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'AssistantMessage',
    tableName: 'assistant_messages',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
