import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * One row per pair, NORMALISED so the lower id is always `ticket_id`. The
 * relationship is symmetric, so the unique index alone prevents a duplicate in
 * either direction (FR-048) — there is no application check to forget.
 */
export class TicketLink extends Model<
  InferAttributes<TicketLink>,
  InferCreationAttributes<TicketLink>
> {
  declare id: CreationOptional<number>;
  declare ticket_id: number;
  declare linked_ticket_id: number;
  /**
   * NULL means the SYSTEM created this link — Phase 5's closed-ticket rule,
   * where an inbound reply raises a new ticket and links it to the closed one
   * it continues (research D8). No actor, so no creator.
   */
  declare created_by_user_id: number | null;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

TicketLink.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    linked_ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'TicketLink',
    tableName: 'ticket_links',
  },
);

/** The one place a pair is ordered. Both writes and reads go through it. */
export function normalisePair(a: number, b: number): { ticketId: number; linkedTicketId: number } {
  return a <= b ? { ticketId: a, linkedTicketId: b } : { ticketId: b, linkedTicketId: a };
}

export default TicketLink;
