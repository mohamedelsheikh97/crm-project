'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('customer_notes', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'customers', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      author_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      body: { type: Sequelize.TEXT, allowNull: false },
      // Separate from updated_at deliberately: updated_at moves for any write,
      // while edited_at means specifically "a human changed what this says",
      // which is what the interface must surface (FR-026).
      edited_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The profile reads one customer's notes, most recent first, paged.
    await queryInterface.addIndex('customer_notes', ['customer_id', 'created_at'], {
      name: 'customer_notes_customer_created',
    });

    // NO visibility column (Clarifications Q2). Every note is visible to anyone
    // who may view the customer.
  },

  async down(queryInterface) {
    await queryInterface.dropTable('customer_notes');
  },
};
