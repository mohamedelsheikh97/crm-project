'use strict';

/**
 * Which categories a user is competent in (Phase 6, Clarifications Q3,
 * FR-044a, FR-044c, research.md D14).
 *
 * PLAN.md names "skill-based" assignment. This is the whole of it: a FLAT SET
 * of ticket categories per user, reusing the taxonomy Phase 3 already fixed,
 * with NO levels, NO weights, and NO teams. A full skills model with named
 * skills and proficiency is the speculative abstraction the constitution's YAGNI
 * rule prohibits, and departments — which will reopen routing properly — are
 * Phase 12.
 *
 * A JOIN TABLE, NOT A JSON COLUMN ON `users`, because the routing query filters
 * by it (`WHERE category = ?`), which is exactly what a JSON column is bad at.
 *
 * THE COMPOSITE PRIMARY KEY IS THE SET. A duplicate is impossible rather than
 * deduplicated, which is the difference between a constraint and a convention.
 *
 * `category` is validated against tickets/taxonomy.ts in the service rather
 * than by an ENUM here, so adding a category there does not require a migration.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_competencies', {
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      category: { type: Sequelize.STRING(30), primaryKey: true, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // "Who is competent in this ticket's category?" — the routing query.
    await queryInterface.addIndex('user_competencies', ['category'], {
      name: 'user_competencies_category',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('user_competencies', 'user_competencies_category');
    await queryInterface.dropTable('user_competencies');
  },
};
