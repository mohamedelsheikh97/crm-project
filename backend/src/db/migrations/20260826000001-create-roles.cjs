'use strict';

/**
 * The three roles are inserted here rather than by a seeder, deliberately.
 *
 * FR-021 fixes the role set permanently — no endpoint creates, renames, or
 * deletes a role — so they are immutable reference data the schema depends on,
 * not mutable seed data. Critically, the next migration adds a NOT NULL
 * `users.role_id` foreign key that must be backfilled, and seeders run *after*
 * all migrations. Leaving these rows to a seeder makes that backfill reference
 * an empty table.
 *
 * Role *permissions* are a different matter: Administrators edit them at
 * runtime, so their defaults live in a seeder that reconciles.
 *
 * @type {import('sequelize-cli').Migration}
 */
const ROLES = [
  { key: 'agent', name_key: 'role.name.agent', description_key: 'role.description.agent' },
  {
    key: 'supervisor',
    name_key: 'role.name.supervisor',
    description_key: 'role.description.supervisor',
  },
  { key: 'admin', name_key: 'role.name.admin', description_key: 'role.description.admin' },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('roles', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // The stable identifier code refers to: agent | supervisor | admin.
      key: { type: Sequelize.STRING(50), allowNull: false },
      // i18n keys, never literal labels (Constitution Principle I).
      name_key: { type: Sequelize.STRING(100), allowNull: false },
      description_key: { type: Sequelize.STRING(100), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('roles', ['key'], {
      unique: true,
      name: 'roles_key_unique',
    });

    const now = new Date();

    await queryInterface.bulkInsert(
      'roles',
      ROLES.map((role) => ({ ...role, created_at: now, updated_at: now })),
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('roles');
  },
};
