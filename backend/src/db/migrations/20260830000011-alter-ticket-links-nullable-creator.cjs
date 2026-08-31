'use strict';

/**
 * Ticket links learn to be created by nobody (Phase 5).
 *
 * The third and last column this phase relaxes, and they are one idea rather
 * than three accidents: PHASE 5 IS THE FIRST PHASE IN WHICH THE SYSTEM ACTS
 * WITHOUT A PERSON. Before it, every row in this project was written because
 * somebody clicked something.
 *
 *   ...000001  tickets.created_by_user_id       — the system raises a ticket
 *   ...000010  ticket_history.actor_user_id     — the system records an event
 *   ...000011  ticket_links.created_by_user_id  — the system links two tickets
 *
 * This one is needed by the closed-ticket rule (research.md D8, FR-025): a
 * reply to a closed ticket creates a new ticket LINKED to the closed one, and
 * the thing that creates the link is an inbound message with no actor.
 *
 * The alternative in every case was a seeded "system" user, rejected in D9 for
 * reasons that only compound as the count grows: it would appear in user lists
 * and assignment pickers, need a role and a password hash, and have to be
 * excluded by name from Phase 1's last-administrator tests and Phase 4's
 * ownership matrix. A null and a reason are cheaper and more honest than a
 * person who does not exist.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('ticket_links', 'created_by_user_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    // REFUSE rather than corrupt, as the other two do.
    const [rows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS count FROM `ticket_links` WHERE `created_by_user_id` IS NULL',
    );

    if (Number(rows[0].count) > 0) {
      throw new Error(
        `Cannot revert: ${rows[0].count} link(s) were created by the system and have no creator. ` +
          'Remove them before rolling this migration back.',
      );
    }

    await queryInterface.changeColumn('ticket_links', 'created_by_user_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
    });
  },
};
