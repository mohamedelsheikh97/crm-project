'use strict';

/**
 * A symmetric relationship between two distinct tickets that bear on each
 * other without either losing its identity (FR-047).
 *
 * ONE ROW PER PAIR, normalised on write so the lower id is always `ticket_id`.
 * The relationship is symmetric, so storing both directions would double the
 * rows and create the possibility of the two halves disagreeing. Normalising
 * means the unique index ALONE prevents a duplicate link in either direction
 * (FR-048) — there is no application check to forget.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ticket_links', {
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
      linked_ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      created_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('ticket_links', ['ticket_id', 'linked_ticket_id'], {
      name: 'ticket_links_pair',
      unique: true,
    });
    // So the reverse lookup is as cheap as the forward one.
    await queryInterface.addIndex('ticket_links', ['linked_ticket_id'], {
      name: 'ticket_links_linked',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ticket_links');
  },
};
