import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * One customer-to-bot exchange (Phase 9, research.md D5).
 *
 * Belongs to a portal account OR an anonymous chat visitor, never both, and
 * never to a `users.id` — the Phase 8 realm separation applies unchanged.
 *
 * `ticket_id` is UNIQUE and set exactly once. That is what makes escalation
 * idempotent by construction (FR-036c) rather than by a check that can lose a
 * race: a second escalation is a duplicate-key violation, which the service
 * translates into "already escalated" and hands back the existing reference.
 */
export class AssistantConversation extends Model<
  InferAttributes<AssistantConversation>,
  InferCreationAttributes<AssistantConversation>
> {
  declare id: CreationOptional<number>;
  declare portal_account_id: CreationOptional<number | null>;
  declare anon_token_hash: CreationOptional<string | null>;
  /** CONTENT language, fixed at the first message. Not the interface locale. */
  declare lang: 'ar' | 'en';
  declare ticket_id: CreationOptional<number | null>;
  declare escalated_at: CreationOptional<Date | null>;
  declare last_activity_at: CreationOptional<Date>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AssistantConversation.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    portal_account_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    anon_token_hash: { type: DataTypes.CHAR(64), allowNull: true },
    lang: { type: DataTypes.ENUM('ar', 'en'), allowNull: false },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, unique: true },
    escalated_at: { type: DataTypes.DATE, allowNull: true },
    last_activity_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'AssistantConversation',
    tableName: 'assistant_conversations',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
