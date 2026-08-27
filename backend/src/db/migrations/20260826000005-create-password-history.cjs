'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('password_history', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      password_hash: { type: Sequelize.STRING(255), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The reuse check reads the most recent N for one user.
    await queryInterface.addIndex('password_history', ['user_id', 'created_at'], {
      name: 'password_history_user_created',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('password_history');
  },
};
