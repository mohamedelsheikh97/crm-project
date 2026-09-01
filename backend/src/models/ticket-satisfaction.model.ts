import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * How the customer rated the resolution (Phase 8, research.md D8).
 *
 * AT MOST ONE PER TICKET, enforced by the unique index on `ticket_id` rather
 * than by a service check. A check-then-insert passes every test and still
 * admits two rows when a customer double-clicks; the index makes the second
 * insert fail, and "already recorded" is then the truth rather than a race the
 * code hoped not to lose (FR-049).
 *
 * That also makes FR-054 unrepresentable rather than merely forbidden: a ticket
 * reopened and re-resolved cannot hold a second, contradicting score.
 *
 * Two rules are NOT expressible here and live in the service:
 *
 *   - the ticket must be `resolved` or `closed` at submission (FR-047)
 *   - the submitter must be the ticket's `requesting_contact_id` (FR-055)
 *
 * NO ATTACHMENTS on the comment. The portal accepts no inbound files at all in
 * this phase (FR-022).
 */
export class TicketSatisfaction extends Model<
  InferAttributes<TicketSatisfaction>,
  InferCreationAttributes<TicketSatisfaction>
> {
  declare id: CreationOptional<number>;
  declare ticket_id: number;
  declare score: number;
  declare comment: CreationOptional<string | null>;
  /**
   * Nullable at the FK so removing a contact does not delete a score Phase 10
   * has counted — but always set on insert, because a rating with no author
   * could not have been validated against FR-055.
   */
  declare submitted_by_contact_id: number | null;
  declare submitted_at: Date;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

TicketSatisfaction.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
    score: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
      set(value: string | null) {
        const trimmed = typeof value === 'string' ? value.trim() : null;
        this.setDataValue('comment', trimmed === '' ? null : trimmed);
      },
    },
    submitted_by_contact_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    submitted_at: { type: DataTypes.DATE, allowNull: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'TicketSatisfaction', tableName: 'ticket_satisfaction' },
);

export default TicketSatisfaction;
