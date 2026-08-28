import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * APPEND-ONLY. There is no update path and no destroy method, and none may be
 * added — the same posture audit_logs took in Phase 1 (FR-034).
 *
 * `ticket_id` is the ticket the event happened TO and is never rewritten on
 * merge. A merged ticket's history is READ by spanning the chain, not by
 * moving rows, because the provenance is what the history exists for
 * (research.md D3).
 */
export class TicketHistory extends Model<
  InferAttributes<TicketHistory>,
  InferCreationAttributes<TicketHistory>
> {
  declare id: CreationOptional<number>;
  declare ticket_id: number;
  declare event: string;
  declare actor_user_id: number;
  /** Snapshotted so an entry stays attributed once the actor is deactivated. */
  declare actor_name: string;
  declare field: CreationOptional<string | null>;
  declare previous_value: CreationOptional<string | null>;
  declare new_value: CreationOptional<string | null>;
  declare note: CreationOptional<string | null>;
  declare readonly created_at: CreationOptional<Date>;
}

TicketHistory.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    event: { type: DataTypes.STRING(50), allowNull: false },
    actor_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    actor_name: { type: DataTypes.STRING(255), allowNull: false },
    field: { type: DataTypes.STRING(50), allowNull: true },
    previous_value: { type: DataTypes.TEXT, allowNull: true },
    new_value: { type: DataTypes.TEXT, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    created_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'TicketHistory',
    tableName: 'ticket_history',
    // An append-only row is never updated, so it has no updated_at to maintain.
    updatedAt: false,
  },
);

export default TicketHistory;
