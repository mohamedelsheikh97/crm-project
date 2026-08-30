import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * A reference from a note to a user, and the reason a notification exists.
 *
 * Rows rather than a parse of the body, because the UNIQUE (note_id, user_id)
 * index IS FR-039: mentioning the same person twice in one note cannot produce
 * two notifications, because it cannot produce two rows. That is a database
 * guarantee rather than dedupe logic somebody has to remember to write
 * (research.md D5).
 *
 * A mention resolves to a real, ACTIVE user at composition time (FR-037), and
 * the row survives that user's later deactivation (FR-035).
 */
export class TicketNoteMention extends Model<
  InferAttributes<TicketNoteMention>,
  InferCreationAttributes<TicketNoteMention>
> {
  declare id: CreationOptional<number>;
  declare note_id: number;
  declare user_id: number;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

TicketNoteMention.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    note_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'TicketNoteMention', tableName: 'ticket_note_mentions' },
);

export default TicketNoteMention;
