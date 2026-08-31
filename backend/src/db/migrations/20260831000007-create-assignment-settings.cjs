'use strict';

/**
 * How unassigned work is distributed (Phase 6, FR-043-FR-047).
 *
 * Single-row configuration. A table rather than an environment variable because
 * FR-043 requires runtime editability and FR-044d requires the change audited.
 *
 * `'off'` IS A STRATEGY, NOT A NULL. FR-043 requires turning automatic
 * assignment off entirely, and an enum member cannot be forgotten by a caller
 * the way a null check can. It is also the SEEDED DEFAULT: automatic assignment
 * changes who does the work, and a fresh installation must not start
 * redistributing tickets before an administrator has chosen to.
 *
 * `round_robin_cursor_user_id` IS STORED, NOT DERIVED (research D12). Deriving
 * it — "the assignee of the most recently auto-assigned ticket" — breaks the
 * moment that ticket is reassigned, merged, or falls out of the consideration
 * set, and FR-046 requires two runs on identical state to produce identical
 * results.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('assignment_settings', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      strategy: {
        type: Sequelize.ENUM('off', 'round_robin', 'least_loaded', 'competency'),
        allowNull: false,
        defaultValue: 'off',
      },
      // NULL = no ceiling (FR-047). Deliberately not 0, which reads as "assign
      // nobody anything" and is a different intention entirely.
      max_open_per_agent: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
      round_robin_cursor_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      updated_by_user_id: {
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable('assignment_settings');
  },
};
