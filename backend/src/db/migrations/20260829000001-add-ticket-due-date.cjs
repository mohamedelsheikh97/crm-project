'use strict';

/**
 * Due dates on tickets (Phase 4, research.md D3, Clarifications Q1).
 *
 * `due_at` is set MANUALLY in this phase. Nothing computes it, nothing infers
 * it from priority, and nothing assigns it automatically. Phase 6 replaces the
 * SOURCE of the value with a computed SLA target; FR-028 requires that every
 * consumer — the queue sort, the overdue indicator, the warning sweep — reads
 * this column and nothing else, so that substitution rebuilds none of them.
 *
 * `due_warning_sent_for` holds THE DUE DATE VALUE ALREADY WARNED ABOUT, not a
 * boolean and not the time the warning was sent. That single choice is FR-045
 * in full:
 *
 *   warn when   due_warning_sent_for IS NULL OR due_warning_sent_for <> due_at
 *
 *   - re-saving the same date does not re-fire (the values still match)
 *   - moving the date to a new value arms a new warning, which is correct
 *   - no second table, no state machine
 *
 * Do not "simplify" this to a boolean. A boolean cannot tell a re-save from a
 * reschedule.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tickets', 'due_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('tickets', 'due_warning_sent_for', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // Serves the due-soon sweep, which runs every 60 seconds against every
    // workable ticket that has a date.
    await queryInterface.addIndex('tickets', ['due_at'], {
      name: 'tickets_due_at',
    });
  },

  async down(queryInterface) {
    // Index first: dropping a column an index depends on is the failure mode
    // Phase 1 hit.
    await queryInterface.removeIndex('tickets', 'tickets_due_at');
    await queryInterface.removeColumn('tickets', 'due_warning_sent_for');
    await queryInterface.removeColumn('tickets', 'due_at');
  },
};
