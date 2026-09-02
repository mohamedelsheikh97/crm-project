'use strict';

/**
 * Synchronisation runs and what each did to each record
 * (Phase 11, FR-044 - FR-049, research D13).
 *
 * ONE `running` ROW PER ADAPTER, ENFORCED BY THE DATABASE (FR-048).
 *
 * A generated column holding the adapter key only while the run is in progress,
 * with a unique index over it. Two concurrent starts therefore cannot both pass:
 * the second insert fails. An application-level check — "is anything running?"
 * then insert — has a window between the read and the write, and the failure it
 * allows is two syncs interleaving their writes to the same customers, which is
 * the one outcome nobody could untangle afterwards.
 *
 * `mode` PUTS PREVIEW AND APPLY ON ONE TABLE. SC-017 requires a preview to
 * report the same set the run applies, and that is checkable by comparing two
 * rows of the same shape rather than two different structures. It also means the
 * preview's per-record classification is stored, so "the preview said X and the
 * run did Y" is answerable after the fact rather than from memory.
 *
 * `cursor` IS AN OPTIMISATION, NOT A CORRECTNESS REQUIREMENT, and that is the
 * right way round. Every record is applied idempotently — upsert keyed on the
 * external identifier — so re-applying is a no-op and a retry is correct
 * regardless of where it starts. The stored position only saves work. A position
 * that is merely an optimisation cannot corrupt anything by being slightly
 * wrong.
 *
 * `reason` IS MANDATORY FOR EVERY NON-TRIVIAL OUTCOME (FR-046). The natural
 * implementation logs "skipped: 47" and leaves the reader to guess. A skip
 * without a reason is a record an administrator cannot act on.
 *
 * `changed_fields` RECORDS BEFORE AND AFTER, which is what makes FR-043's
 * "recorded and visible" true for the conflict case — the value that lost is
 * still readable.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('erp_sync_runs', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      adapter_key: { type: Sequelize.STRING(40), allowNull: false },
      mode: { type: Sequelize.ENUM('preview', 'apply'), allowNull: false },
      state: {
        type: Sequelize.ENUM('running', 'completed', 'failed', 'abandoned'),
        allowNull: false,
        defaultValue: 'running',
      },
      cursor: { type: Sequelize.STRING(255), allowNull: true },
      created_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      updated_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      skipped_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      // Where a human edit was involved (FR-043). Separate from `skipped`
      // because a conflict is a decision the ownership rule made, not a record
      // the sync could not use.
      conflict_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      started_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      started_at: { type: Sequelize.DATE, allowNull: true },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      failure_reason: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    /**
     * The concurrency guard. Holds the adapter key while running and NULL
     * otherwise, so the unique index constrains only in-progress runs — any
     * number of completed runs per adapter, at most one running.
     *
     * Raw SQL because sequelize-cli's `createTable` cannot express a generated
     * column, and expressing it here rather than as an afterthought keeps the
     * constraint in the same migration as the table it guards.
     */
    await queryInterface.sequelize.query(
      'ALTER TABLE `erp_sync_runs` ' +
        'ADD COLUMN `running_adapter_key` VARCHAR(40) ' +
        "GENERATED ALWAYS AS (IF(`state` = 'running', `adapter_key`, NULL)) STORED",
    );

    await queryInterface.addIndex('erp_sync_runs', ['running_adapter_key'], {
      unique: true,
      name: 'erp_sync_runs_one_running_per_adapter',
    });

    await queryInterface.createTable('erp_sync_records', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      sync_run_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'erp_sync_runs', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      external_id: { type: Sequelize.STRING(120), allowNull: false },
      // NULL where creation was skipped — there is no customer to point at.
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'customers', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      outcome: {
        type: Sequelize.ENUM('created', 'updated', 'skipped', 'conflict', 'failed'),
        allowNull: false,
      },
      reason: { type: Sequelize.STRING(255), allowNull: true },
      changed_fields: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The administration screen shows skips and conflicts without reading the
    // whole run, which at 10,000 records is the difference between a page and a
    // timeout.
    await queryInterface.addIndex('erp_sync_records', ['sync_run_id', 'outcome'], {
      name: 'erp_sync_records_run_outcome',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('erp_sync_records');
    await queryInterface.dropTable('erp_sync_runs');
  },
};
