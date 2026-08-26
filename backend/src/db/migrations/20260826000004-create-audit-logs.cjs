'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_logs', {
      // BIGINT because this table grows without bound in this phase — no
      // archival or purge policy is defined (data-model.md).
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      action: { type: Sequelize.STRING(100), allowNull: false },
      // Null when the actor is unauthenticated — a failed sign-in against an
      // unknown identifier (FR-037).
      actor_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      // Captured at the time, so the entry stays readable regardless of what
      // happens to the account later.
      actor_email: { type: Sequelize.STRING(255), allowNull: true },
      target_type: { type: Sequelize.STRING(50), allowNull: true },
      target_id: { type: Sequelize.STRING(100), allowNull: true },
      target_label: { type: Sequelize.STRING(255), allowNull: true },
      outcome: { type: Sequelize.ENUM('success', 'failure'), allowNull: false },
      ip_address: { type: Sequelize.STRING(45), allowNull: true },
      user_agent: { type: Sequelize.STRING(255), allowNull: true },
      previous_value: { type: Sequelize.JSON, allowNull: true },
      new_value: { type: Sequelize.JSON, allowNull: true },
      metadata: { type: Sequelize.JSON, allowNull: true },
      // No updated_at: an append-only row is never updated (FR-035).
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('audit_logs', ['created_at'], {
      name: 'audit_logs_created_at',
    });
    await queryInterface.addIndex('audit_logs', ['actor_user_id'], {
      name: 'audit_logs_actor_user_id',
    });
    await queryInterface.addIndex('audit_logs', ['action'], { name: 'audit_logs_action' });
    // The common filtered-by-type-over-a-range view (research.md D12).
    await queryInterface.addIndex('audit_logs', ['created_at', 'action'], {
      name: 'audit_logs_created_at_action',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
  },
};
