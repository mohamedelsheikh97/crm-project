'use strict';

/**
 * Order matters. full_name and role_id are added nullable, backfilled, then
 * constrained — a NOT NULL column with a foreign key cannot be added to a
 * table that already has rows (data-model.md).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'full_name', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'role_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'is_active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('users', 'must_change_password', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('users', 'failed_login_attempts', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('users', 'locked_until', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'version', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    });

    // Backfill: display name from the email local-part, and every existing
    // account becomes an Administrator (FR-049). must_change_password is
    // deliberately NOT set here, so an established development environment
    // keeps working.
    await queryInterface.sequelize.query(
      "UPDATE users SET full_name = SUBSTRING_INDEX(email, '@', 1) WHERE full_name IS NULL",
    );
    await queryInterface.sequelize.query(
      "UPDATE users SET role_id = (SELECT id FROM roles WHERE `key` = 'admin') WHERE role_id IS NULL",
    );

    await queryInterface.changeColumn('users', 'full_name', {
      type: Sequelize.STRING(255),
      allowNull: false,
    });
    // NOT NULL and the foreign key are applied separately on purpose:
    // changeColumn silently drops allowNull:false when `references` is present,
    // leaving a nullable column that the schema claims is required.
    await queryInterface.changeColumn('users', 'role_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
    });

    await queryInterface.addIndex('users', ['role_id'], { name: 'users_role_id' });

    await queryInterface.addConstraint('users', {
      fields: ['role_id'],
      type: 'foreign key',
      name: 'users_role_id_fk',
      references: { table: 'roles', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addIndex('users', ['is_active'], { name: 'users_is_active' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_is_active');
    // The foreign key must go before its backing index — MySQL refuses to drop
    // an index a constraint still depends on. Sequelize names the constraint
    // users_ibfk_N, so it is looked up rather than assumed.
    const [constraints] = await queryInterface.sequelize.query(
      `SELECT constraint_name AS name FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND table_name = 'users'
         AND column_name = 'role_id' AND referenced_table_name = 'roles'`,
    );

    for (const { name } of constraints) {
      await queryInterface.removeConstraint('users', name);
    }

    await queryInterface.removeIndex('users', 'users_role_id');
    await queryInterface.removeColumn('users', 'version');
    await queryInterface.removeColumn('users', 'locked_until');
    await queryInterface.removeColumn('users', 'failed_login_attempts');
    await queryInterface.removeColumn('users', 'must_change_password');
    await queryInterface.removeColumn('users', 'is_active');
    await queryInterface.removeColumn('users', 'role_id');
    await queryInterface.removeColumn('users', 'full_name');
  },
};
