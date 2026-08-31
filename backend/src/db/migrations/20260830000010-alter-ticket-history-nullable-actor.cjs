'use strict';

/**
 * Ticket history learns to record events nobody caused (Phase 5).
 *
 * THE SAME REASONING AS `tickets.created_by_user_id` in migration ...000001,
 * applied to the second table that records events. Phase 5 is the first phase
 * in which things happen to a ticket without a person doing them: a message
 * arrives from a customer, and the system raises or extends a ticket. There is
 * no actor, and `actor_user_id` was `NOT NULL`.
 *
 * Recording the arrival matters. A ticket whose history jumps from nothing to
 * "status changed" reads as though it appeared from nowhere; an agent looking
 * at why a ticket exists deserves to see that a message arrived and when.
 *
 * `actor_name` stays NOT NULL and carries a KEY, not a sentence — the same rule
 * Phase 4 applied to notification rows. The interface renders it from the
 * locale files, so an Arabic reader is not shown the English word "System".
 *
 * Found during implementation rather than planning: research D9 reasoned about
 * `tickets` and stopped there. Recorded in plan.md under *Changed during
 * implementation*.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('ticket_history', 'actor_user_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    // REFUSE rather than corrupt, exactly as migration ...000001 does. There is
    // no honest user id to give an event the system caused, and inventing one
    // would attribute a machine's action to a person.
    const [rows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS count FROM `ticket_history` WHERE `actor_user_id` IS NULL',
    );

    if (Number(rows[0].count) > 0) {
      throw new Error(
        `Cannot revert: ${rows[0].count} history entr(ies) record events the system caused and ` +
          'have no actor. Remove them before rolling this migration back.',
      );
    }

    await queryInterface.changeColumn('ticket_history', 'actor_user_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
    });
  },
};
