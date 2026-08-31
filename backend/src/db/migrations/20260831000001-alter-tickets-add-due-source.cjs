'use strict';

/**
 * Who put the value in `tickets.due_at` (Phase 6, FR-024b, research.md D6).
 *
 * THE DEFAULT IS NOT ARBITRARY. Every row that exists when this migration runs
 * is backfilled to `manual`, and that is FR-024c stated as a schema decision:
 * a due date typed by a person in Phase 4 is a commitment they made, not a
 * machine value for a policy to overwrite. Phase 4 warned about exactly this —
 * "Phase 6 must not assume this phase's dates were machine-generated" — and a
 * default of `policy` here would silently discard every promise already made.
 *
 * The alternative was inferring it from the ticket history. That is a query,
 * not a fact, and it would be wrong for every ticket raised before Phase 4's
 * due-date events existed.
 *
 * `due_at` itself is deliberately untouched. It is the seam Phase 4 declared in
 * its FR-028 and defended in a comment on ticket-due.service.ts: everything
 * downstream — the queue sort, the overdue filter, the indicator, the
 * approaching-due warning — reads `due_at` and nothing else, so Phase 6 changes
 * where the value comes from and rebuilds none of them.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tickets', 'due_source', {
      type: Sequelize.ENUM('policy', 'manual'),
      allowNull: false,
      defaultValue: 'manual',
      after: 'due_warning_sent_for',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tickets', 'due_source');
  },
};
