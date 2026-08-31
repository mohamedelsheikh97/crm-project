'use strict';

/**
 * What automation actually did (Phase 6, FR-067-FR-070, User Story 7).
 *
 * THE RECORD OUTLIVES THE RULE (FR-070). `rule_id` is ON DELETE SET NULL and
 * `rule_name` is DENORMALISED ALONGSIDE IT, deliberately: a supervisor asking
 * "what changed this ticket overnight?" must get an answer even if the rule was
 * deleted or renamed the next morning, and a foreign key alone cannot survive
 * its target being removed.
 *
 * FOUR OUTCOMES, AND `no_match` IS ONE OF THEM. A rule that did not match is
 * recorded rather than discarded, because User Story 4 requires a non-match to
 * be visibly NOT AN ERROR — and because "the rule never ran" and "the rule ran
 * and the conditions did not hold" are different diagnoses that look identical
 * from an empty table.
 *
 * `detail` HOLDS AN i18n KEY AND PARAMETERS, NEVER A SENTENCE and never a stack
 * trace. The same row may be read by an Arabic user and an English one, so the
 * language cannot be decided at write time — the rule the notifications table
 * has followed since Phase 4.
 *
 * NO DESTROY PATH, following the audit log: bounded by paging, retained.
 *
 * Rule runs are deliberately NOT written to the audit log. Flooding the record
 * an investigator reads is the failure Phase 4 avoided when it declined to audit
 * ordinary note and task activity; this table is their home.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('automation_runs', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      rule_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'automation_rules', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      rule_name: { type: Sequelize.STRING(120), allowNull: false },
      trigger_key: { type: Sequelize.STRING(60), allowNull: false },
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      outcome: {
        type: Sequelize.ENUM('acted', 'no_match', 'suppressed', 'failed'),
        allowNull: false,
      },
      detail: { type: Sequelize.TEXT, allowNull: true },
      // Per-action results, so a partially failed rule (FR-065) is legible
      // rather than collapsing to a single verdict.
      actions_applied: { type: Sequelize.JSON, allowNull: true },
      // Which cascade level this ran at. Makes a suppressed cycle readable
      // rather than merely reported.
      depth: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('automation_runs', ['rule_id', 'created_at'], {
      name: 'automation_runs_rule',
    });
    await queryInterface.addIndex('automation_runs', ['ticket_id', 'created_at'], {
      name: 'automation_runs_ticket',
    });
    await queryInterface.addIndex('automation_runs', ['created_at'], {
      name: 'automation_runs_created',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('automation_runs', 'automation_runs_created');
    await queryInterface.removeIndex('automation_runs', 'automation_runs_ticket');
    await queryInterface.removeIndex('automation_runs', 'automation_runs_rule');
    await queryInterface.dropTable('automation_runs');
  },
};
