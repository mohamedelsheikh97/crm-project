'use strict';

/**
 * How the customer rated the resolution (Phase 8, research.md D8).
 *
 * THE UNIQUE INDEX ON `ticket_id` IS THE WHOLE OF FR-049. A
 * check-then-insert passes every test and still admits two rows when a customer
 * double-clicks; a unique index makes the second insert FAIL, and "already
 * recorded" is then the truthful response rather than a race the code hoped not
 * to lose. Do not replace it with a service-level check.
 *
 * It also makes FR-054 unrepresentable rather than merely forbidden: a ticket
 * reopened and re-resolved cannot hold a second, contradicting score. The first
 * response stands — chosen over "the latest wins" because the alternative lets
 * a ticket's score change after Phase 10 has counted it, and because a customer
 * who has already said the answer was wrong has not withdrawn that by being
 * asked again.
 *
 * TWO RULES THAT ARE NOT EXPRESSIBLE HERE and live in the service:
 *
 *   - the ticket must be `resolved` or `closed` at submission (FR-047)
 *   - the submitter must be the ticket's `requesting_contact_id` (FR-055)
 *
 * `submitted_by_contact_id` is SET NULL on delete rather than CASCADE: removing
 * a contact must not delete a score Phase 10 has already counted. It is
 * NOT NULL on insert, because a rating with no author could not have been
 * validated against FR-055.
 *
 * NO ATTACHMENTS on the comment (FR-022). The portal accepts no inbound files
 * at all in this phase.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ticket_satisfaction', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // 1-5, and the scale is declared once in src/portal/satisfaction.ts.
      score: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false },
      comment: { type: Sequelize.TEXT, allowNull: true },
      submitted_by_contact_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'customer_contacts', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      submitted_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // THE INVARIANT. See the header.
    await queryInterface.addIndex('ticket_satisfaction', ['ticket_id'], {
      name: 'ticket_satisfaction_ticket_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ticket_satisfaction');
  },
};
