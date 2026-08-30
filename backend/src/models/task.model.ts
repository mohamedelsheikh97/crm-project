import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * A personal follow-up commitment.
 *
 * `owner_user_id` is taken from the SESSION and never from the request body.
 * Tasks are personal (Clarifications Q3) — delegation already has a mechanism
 * in this system, Phase 3 ticket assignment, and PLAN.md does not name a second
 * one. An ownership column the client cannot influence is a stronger guarantee
 * than a validation rule somebody could forget.
 *
 * NO DESTROY PATH and no status column. `completed_at` NULL means outstanding;
 * setting it completes (FR-059), clearing it reopens (FR-060).
 *
 * `reminded_at` is what makes FR-063 true BY CONSTRUCTION. The sweep matches
 * `remind_at <= now AND reminded_at IS NULL` with NO LOWER BOUND, so a reminder
 * whose time passed while the process was down still fires on the next tick
 * after restart. Changing `remind_at` clears `reminded_at`, re-arming it
 * (FR-062).
 *
 * At most one of `ticket_id` / `customer_id` is set (FR-056) — enforced here in
 * the service AND by a CHECK constraint, so the invariant survives a direct
 * write.
 */
export class Task extends Model<InferAttributes<Task>, InferCreationAttributes<Task>> {
  declare id: CreationOptional<number>;
  /** From the session context. Never a request field. */
  declare owner_user_id: number;
  declare title: string;
  declare due_at: CreationOptional<Date | null>;
  declare remind_at: CreationOptional<Date | null>;
  /** Null = the reminder has not fired. */
  declare reminded_at: CreationOptional<Date | null>;
  /** Null = outstanding. */
  declare completed_at: CreationOptional<Date | null>;
  declare ticket_id: CreationOptional<number | null>;
  declare customer_id: CreationOptional<number | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

Task.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    owner_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      set(value: string) {
        this.setDataValue('title', String(value).trim());
      },
    },
    due_at: { type: DataTypes.DATE, allowNull: true },
    remind_at: { type: DataTypes.DATE, allowNull: true },
    reminded_at: { type: DataTypes.DATE, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'Task', tableName: 'tasks' },
);

export default Task;
