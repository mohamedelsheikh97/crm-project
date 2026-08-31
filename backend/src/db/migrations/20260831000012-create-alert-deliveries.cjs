'use strict';

/**
 * One attempt to reach one recipient over one transport (Phase 6, FR-076).
 *
 * FOUR OUTCOMES, AND THE DISTINCTION BETWEEN THEM IS THE REQUIREMENT. FR-076
 * asks that "nobody was told" be distinguishable from "we tried and the gateway
 * refused", and three of these four exist only to keep that distinction:
 *
 *   delivered  — it went.
 *   skipped    — the recipient has no reachable address for this transport
 *                (FR-077). Not a failure: there was nothing to try.
 *   suppressed — the FR-078 ceiling stopped it. We chose not to send.
 *   failed     — the transport refused it. We tried and could not.
 *
 * Collapsing these to a boolean would make an unreachable recipient
 * indistinguishable from a broken gateway, which is precisely the diagnosis
 * someone will need at 03:00 when an escalation went unanswered.
 *
 * `detail` carries the transport's own reason and NEVER a credential — the
 * audit service's redaction rules exist for the same hazard.
 *
 * An alert to a USER writes a row here and NO `messages` row (research D13).
 * `messages` is customer correspondence, the structure Clarifications Q3 kept
 * free of internal content and Phase 8 will build a customer-facing view on;
 * operational traffic to agents must not enter it.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('alert_deliveries', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      event_key: { type: Sequelize.STRING(60), allowNull: false },
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      // Null when the recipient was a customer rather than a user.
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'customers', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      transport: { type: Sequelize.ENUM('in_app', 'email', 'sms'), allowNull: false },
      outcome: {
        type: Sequelize.ENUM('delivered', 'skipped', 'suppressed', 'failed'),
        allowNull: false,
      },
      detail: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('alert_deliveries', ['event_key', 'created_at'], {
      name: 'alert_deliveries_event',
    });
    // What the FR-078 ceiling would query if the in-process limiter were ever
    // replaced by a shared store (research D15).
    await queryInterface.addIndex('alert_deliveries', ['user_id', 'created_at'], {
      name: 'alert_deliveries_recipient',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('alert_deliveries', 'alert_deliveries_recipient');
    await queryInterface.removeIndex('alert_deliveries', 'alert_deliveries_event');
    await queryInterface.dropTable('alert_deliveries');
  },
};
