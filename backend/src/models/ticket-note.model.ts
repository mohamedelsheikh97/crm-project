import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * An internal, attributed, dated comment on a ticket.
 *
 * Distinct from ticket_history: history records WHAT CHANGED, a note records
 * what a person wants the next person to know. Distinct from customer_notes
 * because the two carry different permissions — folding them into one
 * polymorphic table would be a speculative abstraction (research.md D5).
 *
 * `edited_at` is deliberately separate from `updated_at`, exactly as
 * customer_notes does: the latter moves for any write, while the former means
 * specifically "a human changed what this says" (FR-033). A silently rewritten
 * note is worse than no note.
 *
 * `body` holds `@[user:12]` mention tokens, NOT display names. A stored name
 * goes stale on rename and misattributes after deactivation (FR-035, FR-041).
 *
 * NO visibility column and NO customer-facing read path (FR-031). Phase 8
 * builds the customer portal; this is one of the things it must not show.
 */
export class TicketNote extends Model<
  InferAttributes<TicketNote>,
  InferCreationAttributes<TicketNote>
> {
  declare id: CreationOptional<number>;
  declare ticket_id: number;
  declare author_user_id: number;
  declare body: string;
  declare edited_at: CreationOptional<Date | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

TicketNote.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    author_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      set(value: string) {
        this.setDataValue('body', String(value).trim());
      },
    },
    edited_at: { type: DataTypes.DATE, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'TicketNote', tableName: 'ticket_notes' },
);

export default TicketNote;
