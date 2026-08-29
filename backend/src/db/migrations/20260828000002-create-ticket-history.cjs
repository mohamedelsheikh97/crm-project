'use strict';

/**
 * Per-ticket history — SEPARATE FROM audit_logs ON PURPOSE (research.md D2).
 *
 * This is read routinely by anyone who may view the ticket (FR-037), while the
 * audit log is audit:view only. Reconciling those two access rules inside one
 * store would put a visibility condition on every audit query, and the
 * direction that fails is leaking administrative events to an Agent.
 *
 * APPEND-ONLY. There is no update path, no destroy method, and no endpoint —
 * the same posture audit_logs took in Phase 1.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ticket_history', {
      // BIGINT: this table grows with ticket volume rather than ticket count.
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // The ticket the event happened TO. Never rewritten on merge — the
      // provenance is the whole point (research.md D3).
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      event: { type: Sequelize.STRING(50), allowNull: false },
      actor_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // Captured at the time, so an entry stays attributed and readable once
      // the actor is deactivated (FR-038).
      actor_name: { type: Sequelize.STRING(255), allowNull: false },
      field: { type: Sequelize.STRING(50), allowNull: true },
      previous_value: { type: Sequelize.TEXT, allowNull: true },
      new_value: { type: Sequelize.TEXT, allowNull: true },
      note: { type: Sequelize.TEXT, allowNull: true },
      // No updated_at: an append-only row is never updated.
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('ticket_history', ['ticket_id', 'created_at'], {
      name: 'ticket_history_ticket_created',
    });
    // `id` is the tiebreaker because MySQL DATETIME is second-precision and
    // several events routinely land in the same second — the defect Phase 2
    // found with customer notes.
    await queryInterface.addIndex('ticket_history', ['ticket_id', 'id'], {
      name: 'ticket_history_ticket_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ticket_history');
  },
};
