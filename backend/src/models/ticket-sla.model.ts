import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * THE PER-TICKET CLOCK (Phase 6, research.md D1).
 *
 * ONE ROW PER TICKET **THAT MATCHED A POLICY**. A ticket matching none has no
 * row at all, which is FR-014 made structural: there is no state in which a
 * ticket with no commitment can be reported as breaching one. Do not create a
 * row with null targets as a placeholder.
 *
 * THE THREE MARKER COLUMNS HOLD A TARGET VALUE, NOT A FLAG (research D4). This
 * is the single most load-bearing decision in the table, and it is Phase 4's
 * `due_warning_sent_for` pattern applied to escalation:
 *
 *   - FR-034 (fire once)          the marker equals the target; a second pass
 *                                 matches nothing.
 *   - FR-042 (no re-fire after a  a manual de-escalation changes neither value.
 *     manual de-escalation)
 *   - FR-030 (re-arm on reopen)   the recomputed target is a NEW value, so the
 *                                 marker no longer matches.
 *
 * A boolean cannot tell a re-save from a reschedule. Do not simplify these.
 *
 * `total_paused_ms` IS DISPLAY ONLY and must never enter arithmetic. Pausing
 * rewrites the target at resume (research D3); subtracting an accumulated
 * offset as well would deduct non-working time twice.
 */
export class TicketSla extends Model<
  InferAttributes<TicketSla>,
  InferCreationAttributes<TicketSla>
> {
  declare ticket_id: number;
  /** FR-012. Which policy produced these targets. */
  declare policy_id: CreationOptional<number | null>;
  /** Ticket creation, or the reopening (FR-030). */
  declare started_at: Date;

  /** Absolute and STORED (FR-029) — never recomputed on read. */
  declare response_target_at: CreationOptional<Date | null>;
  declare resolution_target_at: CreationOptional<Date | null>;

  /** Write-once. Nothing clears these, which is FR-016 by construction. */
  declare response_satisfied_at: CreationOptional<Date | null>;
  declare resolution_satisfied_at: CreationOptional<Date | null>;

  /** The recorded outcome Phase 10 reporting must read, not recompute. */
  declare response_breached_at: CreationOptional<Date | null>;
  declare resolution_breached_at: CreationOptional<Date | null>;

  /** Value markers — see the class comment. */
  declare response_warned_for: CreationOptional<Date | null>;
  declare resolution_warned_for: CreationOptional<Date | null>;
  declare resolution_escalated_for: CreationOptional<Date | null>;

  /** Non-null = stopped, and the sweep skips this row (FR-021). */
  declare paused_at: CreationOptional<Date | null>;
  declare response_remaining_ms: CreationOptional<number | null>;
  declare resolution_remaining_ms: CreationOptional<number | null>;
  /** DISPLAY ONLY. Never used in arithmetic. */
  declare total_paused_ms: CreationOptional<number>;

  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

TicketSla.init(
  {
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    policy_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    started_at: { type: DataTypes.DATE, allowNull: false },
    response_target_at: { type: DataTypes.DATE, allowNull: true },
    resolution_target_at: { type: DataTypes.DATE, allowNull: true },
    response_satisfied_at: { type: DataTypes.DATE, allowNull: true },
    resolution_satisfied_at: { type: DataTypes.DATE, allowNull: true },
    response_breached_at: { type: DataTypes.DATE, allowNull: true },
    resolution_breached_at: { type: DataTypes.DATE, allowNull: true },
    response_warned_for: { type: DataTypes.DATE, allowNull: true },
    resolution_warned_for: { type: DataTypes.DATE, allowNull: true },
    resolution_escalated_for: { type: DataTypes.DATE, allowNull: true },
    paused_at: { type: DataTypes.DATE, allowNull: true },
    response_remaining_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    resolution_remaining_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    total_paused_ms: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'TicketSla',
    tableName: 'ticket_sla',
  },
);

export default TicketSla;
