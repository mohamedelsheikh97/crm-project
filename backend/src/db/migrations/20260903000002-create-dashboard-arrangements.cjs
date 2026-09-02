'use strict';

/**
 * One user's own dashboard layout (Phase 10, FR-040).
 *
 * `UNIQUE(user_id)` MAKES "BELONGS ONLY TO THEM" A SCHEMA FACT. There is no path
 * by which one manager's arrangement could become another's, so FR-040 does not
 * rely on a service remembering to scope a query.
 *
 * `layout` HOLDS FIGURE KEYS, NEVER QUERIES, FILTERS OR THRESHOLDS. A user
 * arranging their dashboard must not be able to define what a figure MEANS —
 * that would make the layout a report definition, and a figure whose meaning
 * varies per user is unauditable. Keys are validated against the declared figure
 * catalog on write, so an unknown key is refused rather than stored and silently
 * ignored later (a layout that accumulates dead keys looks broken to its owner).
 *
 * NO `is_shared` COLUMN, DELIBERATELY. FR-065 says a user rearranging their own
 * dashboard needs no audit entry, and that is only safe while an arrangement
 * cannot affect anybody else. A shared arrangement would need an audit entry, a
 * permission, and an answer to FR-042 for viewers with different authority —
 * three problems bought for a convenience nobody asked for.
 *
 * CASCADE on user delete: an arrangement has no meaning without its owner and is
 * not a record anybody would want retained.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('dashboard_arrangements', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // An ordered list of figure keys. Nothing else.
      layout: { type: Sequelize.JSON, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('dashboard_arrangements');
  },
};
