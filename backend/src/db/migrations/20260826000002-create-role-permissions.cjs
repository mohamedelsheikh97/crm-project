'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('role_permissions', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      role_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // A module:action key from the catalog in backend/src/auth/permissions.ts.
      permission_key: { type: Sequelize.STRING(100), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // Declared here rather than only on the model, so a duplicate grant is
    // impossible even via direct SQL.
    await queryInterface.addIndex('role_permissions', ['role_id', 'permission_key'], {
      unique: true,
      name: 'role_permissions_role_key_unique',
    });

    // Answers "which roles grant this?" without a scan.
    await queryInterface.addIndex('role_permissions', ['permission_key'], {
      name: 'role_permissions_permission_key',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('role_permissions');
  },
};
