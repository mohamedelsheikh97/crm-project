import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export type ChatSessionState = 'open' | 'ended';

/**
 * A conversation with a website visitor.
 *
 * `visitor_token` HOLDS A HASH, NOT THE TOKEN. It is a bearer capability:
 * whoever presents it can read and write one conversation. That makes it a
 * credential, and this project already decided how credentials are stored — a
 * database read must not hand over live access. Comparison hashes what the
 * visitor presents, exactly as a password check does.
 *
 * It is deliberately NOT a JWT. A token carrying claims implies a principal,
 * and a visitor is not one: no account, no role, no permissions. An opaque
 * capability scoped to one conversation is the honest model, and revoking it is
 * deleting a row (FR-075).
 *
 * `ticket_id` is null only between the session opening and the first message. A
 * visitor who opens the panel and closes it without typing has not raised a
 * ticket, and manufacturing one would fill the queue with silence.
 */
export class ChatSession extends Model<
  InferAttributes<ChatSession>,
  InferCreationAttributes<ChatSession>
> {
  declare id: CreationOptional<number>;
  /** SHA-256 hex of the issued token. See the class comment. */
  declare visitor_token: string;
  declare ticket_id: CreationOptional<number | null>;
  declare visitor_name: CreationOptional<string | null>;
  declare visitor_identity: CreationOptional<string | null>;
  /** What the widget renders in, and where its direction comes from (FR-076). */
  declare locale: CreationOptional<string>;
  declare state: CreationOptional<ChatSessionState>;
  declare last_seen_at: Date;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ChatSession.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    visitor_token: { type: DataTypes.CHAR(64), allowNull: false },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    visitor_name: { type: DataTypes.STRING(255), allowNull: true },
    visitor_identity: { type: DataTypes.STRING(255), allowNull: true },
    locale: { type: DataTypes.STRING(5), allowNull: false, defaultValue: 'en' },
    state: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
    last_seen_at: { type: DataTypes.DATE, allowNull: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'ChatSession', tableName: 'chat_sessions' },
);

export default ChatSession;
