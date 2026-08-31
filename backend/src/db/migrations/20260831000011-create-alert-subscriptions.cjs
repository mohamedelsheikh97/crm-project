'use strict';

/**
 * Which events reach whom, over which transports (Phase 6, FR-079).
 *
 * `recipient_kind` IS A KIND, NOT A USER ID, AND THAT IS THE DESIGN. FR-041's
 * audience is "the ticket's assignee plus the supervisory recipients". Naming
 * individuals would break the first time someone changed job, and would need
 * maintaining every time a person joined or left — a subscription list that
 * silently stops reaching anyone is worse than no subscription list.
 *
 * `in_app` IS STORED BUT CANNOT BE TURNED OFF. FR-073 makes the in-application
 * notification unconditional; the column exists so the screen can render it as
 * an always-on DISABLED control rather than hiding a transport that behaves
 * differently from the two beside it. A control that looks adjustable and is not
 * is worse than one shown as fixed.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('alert_subscriptions', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // `sla.response_at_risk`, `sla.resolution_breached`, `assignment.failed`.
      // Validated against a declared list in the service.
      event_key: { type: Sequelize.STRING(60), allowNull: false },
      recipient_kind: { type: Sequelize.ENUM('assignee', 'role'), allowNull: false },
      // Required when recipient_kind = 'role', enforced in the service.
      role_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'roles', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      in_app: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      by_email: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      by_sms: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('alert_subscriptions', ['event_key', 'recipient_kind', 'role_id'], {
      name: 'alert_subscriptions_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('alert_subscriptions', 'alert_subscriptions_unique');
    await queryInterface.dropTable('alert_subscriptions');
  },
};
