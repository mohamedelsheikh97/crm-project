import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { TicketStatus } from '../tickets/lifecycle.js';
import type { TicketCategory, TicketPriority } from '../tickets/taxonomy.js';

/**
 * How a ticket came to exist (Phase 5, FR-026).
 *
 * `manual` is what every ticket raised before Phase 5 is, and what the column
 * default backfills them to. The rest name the channel that created it, so an
 * administrator can ask "which of these arrived on their own?" without joining
 * to messages.
 */
export const TICKET_SOURCES = [
  'manual',
  'email',
  'whatsapp',
  'sms',
  'chat',
  'form',
  // Phase 8, FR-021. Distinguishable from `form`, the other self-service
  // origin, so an administrator can ask "which of these came from the portal?"
  // without joining to messages.
  'portal',
] as const;

export type TicketSource = (typeof TICKET_SOURCES)[number];

/**
 * Guards the one place a source is chosen from an untyped value.
 *
 * Every caller passes a literal it decided itself — intake passes the channel it
 * received on, the portal passes `'portal'`. This exists so `ticket.service`
 * never has to cast, and so a value that is not a declared source falls back to
 * `manual` rather than reaching the column.
 */
export function isTicketSource(value: unknown): value is TicketSource {
  return typeof value === 'string' && (TICKET_SOURCES as readonly string[]).includes(value);
}

/**
 * Who set the due date (Phase 6, FR-024b, research.md D6).
 *
 * Two values because a due date now has two possible authors, and every surface
 * showing one has to be able to say which — a supervisor asking "why is this
 * date what it is?" needs an answer on both.
 */
export const DUE_SOURCES = ['policy', 'manual'] as const;

export type DueSource = (typeof DUE_SOURCES)[number];

/**
 * NO DESTROY PATH, for the same reason customers have none: a ticket is merged
 * or closed, never deleted. `merge` emits record.deleted as the
 * security-relevant fact while the row is retained, so every reference to it
 * stays valid. Do not add a delete method, endpoint, or interface control.
 *
 * There is no `reference` column — see backend/src/tickets/reference.ts.
 */
export class Ticket extends Model<InferAttributes<Ticket>, InferCreationAttributes<Ticket>> {
  declare id: CreationOptional<number>;
  declare customer_id: number;
  declare subject: string;
  declare description: string | null;
  declare category: TicketCategory;
  declare priority: TicketPriority;
  declare status: CreationOptional<TicketStatus>;
  declare assignee_user_id: number | null;
  /**
   * WHICH CONTACT RAISED THIS (Phase 8, Clarifications Q2, FR-026a).
   *
   * NULL MEANS INVISIBLE IN THE CUSTOMER PORTAL (FR-026f). It does NOT mean
   * "visible to every contact on the record", and no query may read it that
   * way. Reading absence as permission is the one mistake that would
   * reintroduce exactly the leak Q2 exists to prevent — silently, and on the
   * oldest data in the system.
   *
   * Nullable because FR-026e is real: an agent raising a ticket during a phone
   * call may not know which contact it was, and a default would invent a
   * requester. Every write site must check that the contact belongs to THIS
   * ticket's customer; the foreign key cannot express that.
   */
  declare requesting_contact_id: CreationOptional<number | null>;
  /**
   * NULL means the system raised this ticket from an inbound message (Phase 5,
   * FR-026). Read together with `source`: a null creator and a non-`manual`
   * source is a ticket nobody typed.
   *
   * A seeded "system" user was the alternative and is worse than it looks — it
   * appears in user lists and assignment pickers, needs a role and a password
   * hash, and Phase 1's last-administrator tests and Phase 4's ownership matrix
   * would both have to learn to ignore it.
   */
  declare created_by_user_id: CreationOptional<number | null>;
  /**
   * Where the ticket came from: `manual`, or the channel that created it
   * (Phase 5). `manual` for everything raised before Phase 5, which is correct.
   */
  declare source: CreationOptional<TicketSource>;
  /** Non-null means merged: a redirect, unworkable by every route (FR-043). */
  declare merged_into_ticket_id: CreationOptional<number | null>;
  declare escalation_reason: CreationOptional<string | null>;
  /**
   * Set manually in this phase (Phase 4, Clarifications Q1). Nothing computes
   * it. Phase 6 replaces the SOURCE with a computed SLA target — FR-028 means
   * no consumer may assume a human set it.
   */
  declare due_at: CreationOptional<Date | null>;
  /**
   * The due date value already warned about — not a flag, not the time the
   * warning was sent. `due_warning_sent_for <> due_at` is FR-045 in full: a
   * re-saved date does not re-fire, a rescheduled one arms a new warning.
   */
  declare due_warning_sent_for: CreationOptional<Date | null>;
  /**
   * WHO PUT THE VALUE IN `due_at` (Phase 6, FR-024b).
   *
   * `manual` is what every ticket raised before Phase 6 is, and what the column
   * default backfills them to — which is FR-024c, not an arbitrary default. A
   * date typed by a person in Phase 4 is a commitment they made, and a policy
   * must never quietly overwrite it. Phase 4 said so in its own words: "Phase 6
   * must not assume this phase's dates were machine-generated."
   *
   * A policy writes `due_at` ONLY while this reads `policy`. Setting a date by
   * hand flips it to `manual` permanently; clearing the override flips it back.
   */
  declare due_source: CreationOptional<DueSource>;
  declare version: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

Ticket.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    subject: {
      type: DataTypes.STRING(255),
      allowNull: false,
      set(value: string) {
        this.setDataValue('subject', String(value).trim());
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      set(value: string | null) {
        this.setDataValue('description', value === null ? null : String(value).trim() || null);
      },
    },
    requesting_contact_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    category: { type: DataTypes.STRING(30), allowNull: false },
    priority: { type: DataTypes.STRING(20), allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'new' },
    assignee_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'manual' },
    merged_into_ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    escalation_reason: { type: DataTypes.TEXT, allowNull: true },
    due_at: { type: DataTypes.DATE, allowNull: true },
    due_warning_sent_for: { type: DataTypes.DATE, allowNull: true },
    due_source: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'manual' },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'Ticket',
    tableName: 'tickets',
    // Optimistic locking (FR-010), as customers and users established.
    version: true,
  },
);

export default Ticket;
