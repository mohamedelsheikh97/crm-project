'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('customers', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      display_name: { type: Sequelize.STRING(255), allowNull: false },
      company: { type: Sequelize.STRING(255), allowNull: true },
      // Single free-text field: Arabic and English addresses do not share a
      // structure, and structuring invites validation no requirement asks for.
      address: { type: Sequelize.TEXT, allowNull: true },
      // Deactivation is the ONLY removal (Clarifications Q1), which is what
      // lets Phase 3 treat a customer reference as permanent.
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('customers', ['is_active'], { name: 'customers_is_active' });
    // These do NOT serve LIKE '%term%' — a leading wildcard cannot use a
    // B-tree. They are here for sorting and the prefix case; research.md D3
    // records the accepted linear cost and when to revisit.
    await queryInterface.addIndex('customers', ['display_name'], {
      name: 'customers_display_name',
    });
    await queryInterface.addIndex('customers', ['company'], { name: 'customers_company' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('customers');
  },
};
