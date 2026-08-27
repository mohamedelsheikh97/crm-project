'use strict';

/**
 * A record that someone was warned about a duplicate and decided anyway.
 *
 * Exists because FR-020 and SC-005 require the decision to be retrievable
 * MONTHS later. An audit entry alone records that a save happened with
 * acknowledgement; these rows record precisely which records were on screen
 * when the decision was made.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('customer_duplicate_overrides', {
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
      matched_customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'customers', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      decided_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      matched_on: { type: Sequelize.ENUM('phone', 'email'), allowNull: false },
      matched_value: { type: Sequelize.STRING(255), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('customer_duplicate_overrides', ['customer_id'], {
      name: 'duplicate_overrides_customer_id',
    });
    await queryInterface.addIndex('customer_duplicate_overrides', ['matched_customer_id'], {
      name: 'duplicate_overrides_matched_customer_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('customer_duplicate_overrides');
  },
};
