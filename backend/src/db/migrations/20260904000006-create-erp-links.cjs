'use strict';

/**
 * The correspondence between a customer here and its ERP counterpart
 * (Phase 11, FR-041 - FR-043, research D12).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `last_synced_values` IS THE INTERESTING COLUMN, AND IT PROTECTS AN AGENT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FR-043 forbids a sync silently overwriting a value a person edited here. That
 * requires answering "did a human change this field since we last wrote it?",
 * and there are three ways to try:
 *
 *   - Compare `customers.updated_at` against `last_reconciled_at`. TOO COARSE:
 *     any change to any field marks every field as touched, so either the sync
 *     stops updating anything or it ignores the signal entirely.
 *   - Read the audit log per field. Accurate, expensive, and it makes
 *     correctness depend on audit RETENTION — prune the log and the sync starts
 *     overwriting agents' work.
 *   - Store what we last wrote. A three-way merge, exact for the question being
 *     asked: current equals last-written means nobody touched it; current
 *     differs means somebody did. Needs no history, survives pruning, and the
 *     comparison is local to the row.
 *
 * The third is what this column is. It is sync bookkeeping rather than a
 * property of the customer, which is one of three reasons this is a table and
 * not a `customers.erp_external_id` column — see data-model.md D5 for the other
 * two (a second adapter needs two links for one customer, and Phase 2 owns
 * `customers`).
 *
 * UNIQUE IN BOTH DIRECTIONS (FR-041). One customer has one counterpart; one
 * counterpart maps to one customer. Two ERP records claiming the same external
 * identifier therefore fail at the database rather than on an application check
 * that could race — which is what the spec's edge case asks for.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('erp_links', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        unique: true,
        references: { model: 'customers', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      /**
       * The ERP's own identifier, and the contract says it is stable forever
       * rather than merely unique. An identifier that changes for the same real
       * customer creates a second customer here — a problem to solve in the
       * adapter, not here.
       */
      external_id: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      // Which adapter established the link, so a future second ERP is a data
      // question rather than a schema change.
      adapter_key: { type: Sequelize.STRING(40), allowNull: false },
      last_reconciled_at: { type: Sequelize.DATE, allowNull: true },
      // The values the sync last wrote. The human-edit detector — see above.
      last_synced_values: { type: Sequelize.JSON, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The sync reads by external id; the customer screen reads by customer id
    // (already unique-indexed). Adapter key narrows a multi-ERP future.
    await queryInterface.addIndex('erp_links', ['adapter_key', 'external_id'], {
      name: 'erp_links_adapter_external',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('erp_links');
  },
};
