'use strict';

/**
 * Service commitments (Phase 6, FR-001-FR-009).
 *
 * ROWS, NOT CODE. Phase 3 made categories and priorities code enumerations
 * because the set is fixed and nobody manages it. Policies are the opposite:
 * FR-001 requires an administrator to create and edit them at runtime, and
 * FR-006 requires every change audited. An environment variable or a constant
 * satisfies neither.
 *
 * `specificity` IS STORED RATHER THAN COMPUTED AT MATCH TIME. It is derived on
 * write from which of priority and category are set, and it is what makes
 * FR-013's precedence a single `ORDER BY specificity DESC, updated_at DESC`.
 * Computing it in the matcher would mean the screen that explains precedence to
 * an administrator and the matcher that applies it hold two copies of the same
 * rule, and they would drift.
 *
 * THERE IS DELIBERATELY NO UNIQUE CONSTRAINT ON (priority, category). Two
 * policies may overlap; precedence resolves it. Forbidding overlap would stop
 * an administrator adding a temporary override without first deleting the
 * standing policy, which is the opposite of what FR-013 is for.
 *
 * NO DESTROY PATH (FR-019). A policy tickets reference is deactivated, never
 * deleted, so a ticket's record of what it was measured against stays readable.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sla_policies', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: { type: Sequelize.STRING(120), allowNull: false },
      // Set for the seeded defaults so a fresh install is not English-only
      // (FR-004, Principle I). Optional for user-created policies, which fall
      // back to `name` — an administrator naming their own policy is entitled
      // to name it once.
      name_ar: { type: Sequelize.STRING(120), allowNull: true },
      // NULL means "any". Validated against the Phase 3 taxonomies in the
      // service, not by an ENUM: a priority added to tickets/taxonomy.ts would
      // otherwise need a migration here too.
      priority: { type: Sequelize.STRING(20), allowNull: true },
      category: { type: Sequelize.STRING(30), allowNull: true },
      // Working minutes (research D2), not wall-clock. The distinction is the
      // whole of Clarifications Q1 and is why these are minutes rather than a
      // duration string nobody can index or compare.
      response_minutes: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      resolution_minutes: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      // 3 = priority+category, 2 = priority, 1 = category, 0 = catch-all.
      // Derived on write; never accepted from a client.
      specificity: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
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

    // The matcher's only query: active policies, most specific first.
    await queryInterface.addIndex('sla_policies', ['is_active', 'specificity'], {
      name: 'sla_policies_active_specificity',
    });
    await queryInterface.addIndex('sla_policies', ['priority', 'category'], {
      name: 'sla_policies_scope',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('sla_policies', 'sla_policies_scope');
    await queryInterface.removeIndex('sla_policies', 'sla_policies_active_specificity');
    await queryInterface.dropTable('sla_policies');
  },
};
