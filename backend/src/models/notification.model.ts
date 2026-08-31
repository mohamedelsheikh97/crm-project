import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * The four things this system tells a user about without being asked.
 *
 * Declared here rather than as a bare string union so the scheduler, the
 * services, and the tests all read one list (research.md D2).
 */
export const NOTIFICATION_TYPES = {
  TICKET_ASSIGNED: 'ticket.assigned',
  NOTE_MENTIONED: 'note.mentioned',
  TASK_REMINDER: 'task.reminder',
  TICKET_DUE_SOON: 'ticket.due_soon',

  // Phase 6 — SLA & automation. NO NEW COLUMNS: all three concern a ticket,
  // which this table already references.
  //
  // Automatic assignment deliberately reuses TICKET_ASSIGNED above rather than
  // adding a fourth. FR-050 requires an automatic assignment to produce the
  // same downstream effects as a manual one, and a separate type would make the
  // agent's notification list distinguish two things that are, to the agent,
  // one thing: work arrived.
  SLA_AT_RISK: 'sla.at_risk',
  SLA_BREACHED: 'sla.breached',
  // Nobody eligible to take the ticket. Goes to the supervisory recipients,
  // because an unassignable ticket is a staffing problem rather than an agent's
  // (FR-048).
  ASSIGNMENT_FAILED: 'assignment.failed',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * One message delivered to one recipient.
 *
 * NO MESSAGE COLUMN, AND NONE IS TO BE ADDED. The row carries a type and the
 * identifiers; the client composes the sentence from ar.json / en.json. The
 * same row may be read by an Arabic user and an English one, so the language
 * cannot be decided at write time — and Principle I forbids a hardcoded string
 * regardless.
 *
 * NO DESTROY PATH. Notifications are read, not deleted; the list is bounded by
 * paging (FR-050).
 */
export class Notification extends Model<
  InferAttributes<Notification>,
  InferCreationAttributes<Notification>
> {
  declare id: CreationOptional<number>;
  /** The recipient. The only user who may read this row (FR-051). */
  declare user_id: number;
  declare type: NotificationType;
  /** Null for system-generated notifications — nobody caused them. */
  declare actor_user_id: CreationOptional<number | null>;
  declare ticket_id: CreationOptional<number | null>;
  declare task_id: CreationOptional<number | null>;
  declare note_id: CreationOptional<number | null>;
  /** Null = unread. */
  declare read_at: CreationOptional<Date | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

Notification.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false },
    actor_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    task_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    note_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    read_at: { type: DataTypes.DATE, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'Notification', tableName: 'notifications' },
);

export default Notification;
