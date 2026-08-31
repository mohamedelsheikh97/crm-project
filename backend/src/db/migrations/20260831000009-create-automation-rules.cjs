'use strict';

/**
 * Trigger-condition-action rules (Phase 6, FR-054-FR-061, research.md D9).
 *
 * CONDITIONS AND ACTIONS ARE JSON, VALIDATED AGAINST THE CATALOG ON WRITE.
 * That is not laziness about normalisation — it is what makes FR-058's bounded
 * authority STRUCTURAL. A stored rule can never name a trigger, field, operator
 * or action that automation/catalog.ts does not contain, so the executor may
 * trust its input, and a rule that would do something unintended fails at save
 * time in front of the person who wrote it rather than at 03:00.
 *
 * Child tables were the alternative and buy nothing: conditions and actions are
 * a variable-length list always read and written as a whole, and no query ever
 * asks about one condition.
 *
 * `is_enabled` DEFAULTS TO FALSE. A rule created and not yet dry-run must not
 * fire (FR-061, FR-066). Saving a rule and running a rule should feel like two
 * different acts, because they are.
 *
 * `created_by_user_id` IS THE ACCOUNTABILITY RECORD. FR-086 attributes an
 * automated act in the audit log to the user who CONFIGURED it, so it is
 * captured at creation rather than read from whatever session happened to
 * trigger the rule.
 *
 * Rules ARE hard-deletable (FR-054), and automation_runs deliberately does not
 * cascade (FR-070): the record of what a rule did outlives the rule.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('automation_rules', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: { type: Sequelize.STRING(120), allowNull: false },
      trigger_key: { type: Sequelize.STRING(60), allowNull: false },
      // [{ field, operator, value }]. An empty array means "always" (FR-055).
      conditions_json: { type: Sequelize.JSON, allowNull: false },
      // [{ action, params }]. At least one (FR-055).
      actions_json: { type: Sequelize.JSON, allowNull: false },
      is_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // A single global sequence (FR-060). Not per-trigger, so "what runs
      // first" has one answer rather than one answer per event type.
      run_order: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
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

    // The executor's only lookup: enabled rules for one trigger, in order.
    await queryInterface.addIndex(
      'automation_rules',
      ['is_enabled', 'trigger_key', 'run_order'],
      { name: 'automation_rules_dispatch' },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('automation_rules', 'automation_rules_dispatch');
    await queryInterface.dropTable('automation_rules');
  },
};
