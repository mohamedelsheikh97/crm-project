'use strict';

/**
 * THE PER-TICKET CLOCK (Phase 6, research.md D1).
 *
 * A SEPARATE TABLE, NOT COLUMNS ON `tickets`. `tickets` is the hottest row in
 * this system — every queue query, every list, every dashboard count reads it —
 * and it already carries four phases of accumulated columns. SLA state is a
 * dozen more, of which every one is NULL for a ticket that matched no policy.
 * Keeping them here leaves the list queries untouched and gives the detection
 * sweep its own narrow index instead of a partial scan over the wide table.
 *
 * ONE ROW PER TICKET **THAT MATCHED A POLICY**. A ticket matching none has NO
 * ROW, which is FR-014 made structural rather than checked: there is no state in
 * which a ticket with no commitment can be reported as breaching one.
 *
 * `ticket_id` IS THE PRIMARY KEY, not a surrogate. One row per ticket is a
 * schema guarantee here rather than a service convention.
 *
 * THE MARKER COLUMNS HOLD A TARGET VALUE, NOT A FLAG, and that single choice
 * delivers three requirements at once (research D4, and the pattern Phase 4's
 * `due_warning_sent_for` established):
 *
 *   - FR-034 fire once      — the marker equals the target, so a second pass
 *                             matches nothing.
 *   - FR-042 no re-fire     — a manual de-escalation changes neither value.
 *   - FR-030 re-arm on reopen — the recomputed target is a NEW value, so the
 *                             marker no longer matches.
 *
 * A boolean cannot tell a re-save from a reschedule. Do not simplify these to
 * flags; Phase 4 wrote that warning into ticket-due.service.ts and this table is
 * where ignoring it would be paid for.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ticket_sla', {
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        allowNull: false,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // FR-012. Nullable only so a manual database repair cannot orphan a
      // ticket; FR-019 forbids the hard delete that would produce a null here.
      policy_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'sla_policies', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      // When the clock began: the ticket's creation, or its reopening (FR-030).
      started_at: { type: Sequelize.DATE, allowNull: false },

      // Absolute times, STORED rather than recomputed on read (FR-029), so a
      // later calendar edit moves future targets only.
      response_target_at: { type: Sequelize.DATE, allowNull: true },
      resolution_target_at: { type: Sequelize.DATE, allowNull: true },

      // Write-once. FR-016 holds by construction: nothing clears these, so
      // later correspondence cannot re-arm a satisfied response target.
      response_satisfied_at: { type: Sequelize.DATE, allowNull: true },
      resolution_satisfied_at: { type: Sequelize.DATE, allowNull: true },

      // The recorded outcome, which is what Phase 10 reporting must read.
      // FR-018 makes the stored outcome the record, because the policy that
      // produced it may since have been edited.
      response_breached_at: { type: Sequelize.DATE, allowNull: true },
      resolution_breached_at: { type: Sequelize.DATE, allowNull: true },

      // Value markers. See the header.
      response_warned_for: { type: Sequelize.DATE, allowNull: true },
      resolution_warned_for: { type: Sequelize.DATE, allowNull: true },
      resolution_escalated_for: { type: Sequelize.DATE, allowNull: true },

      // Non-null means the clock is stopped and the sweep skips this row
      // (FR-021). Pausing REWRITES the target at resume rather than
      // accumulating an offset (research D3), which is what makes FR-022's
      // "excluded exactly once" impossible to get wrong.
      paused_at: { type: Sequelize.DATE, allowNull: true },
      response_remaining_ms: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      resolution_remaining_ms: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },

      // DISPLAY ONLY. Never used in arithmetic — subtracting it would deduct
      // non-working time twice, once by the calendar and once by this column.
      total_paused_ms: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },

      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The two indexes the sweep uses. Ordered target-first because that is the
    // selective column; `paused_at` narrows what remains.
    await queryInterface.addIndex('ticket_sla', ['resolution_target_at', 'paused_at'], {
      name: 'ticket_sla_resolution_sweep',
    });
    await queryInterface.addIndex('ticket_sla', ['response_target_at', 'paused_at'], {
      name: 'ticket_sla_response_sweep',
    });
    await queryInterface.addIndex('ticket_sla', ['policy_id'], {
      name: 'ticket_sla_policy',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('ticket_sla', 'ticket_sla_policy');
    await queryInterface.removeIndex('ticket_sla', 'ticket_sla_response_sweep');
    await queryInterface.removeIndex('ticket_sla', 'ticket_sla_resolution_sweep');
    await queryInterface.dropTable('ticket_sla');
  },
};
