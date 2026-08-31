'use strict';

/**
 * Customer correspondence (Phase 5, FR-001). The central table of the phase.
 *
 * THERE IS DELIBERATELY NO `is_internal` COLUMN. Phase 4's internal notes live
 * in `ticket_notes` and stay there. One table with a boolean deciding whether
 * content may leave the building is exactly the design FR-002, FR-044 and
 * SC-006 exist to prevent: a wrong default, a missed filter, or a mis-set prop
 * becomes a disclosure of something a colleague wrote in confidence. Two tables
 * make that mistake unrepresentable rather than merely unlikely.
 *
 * `occurred_at` IS NOT `created_at`. The first is when the communication
 * happened according to the channel; the second is when this system recorded
 * it. They differ whenever a poller catches up or a provider redelivers late,
 * and FR-092 orders the timeline by the former — a message a customer sent an
 * hour ago belongs an hour ago, not at the moment we noticed it.
 *
 * `outbound_message_id` is UNIQUE because it is the threading lookup
 * (research D4): an inbound reply's In-Reply-To is matched against it. Two
 * outbound messages sharing an identifier would silently thread a customer's
 * reply onto the wrong ticket.
 *
 * NO customer_id. A message's customer is its ticket's customer. Storing it
 * here would create a second place for the truth to live, which the customer
 * merge in FR-019 would then have to keep in step. The timeline joins through
 * `tickets` instead, on the index Phase 3 already has.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('messages', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      ticket_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      channel: { type: Sequelize.STRING(20), allowNull: false },
      direction: { type: Sequelize.STRING(10), allowNull: false },
      // Set on outbound, null on inbound. RESTRICT because an agent who has
      // left must not take their correspondence with them.
      author_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // As received. Never rewritten — the same rule customer_contacts follows.
      sender_identity: { type: Sequelize.STRING(255), allowNull: true },
      // Through lib/phone.ts, and what identity resolution matched on.
      sender_identity_normalised: { type: Sequelize.STRING(255), allowNull: true },
      body: { type: Sequelize.TEXT('medium'), allowNull: false },
      // Records what ARRIVED, so nothing is re-guessed on read.
      body_format: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'text' },
      provider_message_id: { type: Sequelize.STRING(255), allowNull: true },
      outbound_message_id: { type: Sequelize.STRING(255), allowNull: true },
      delivery_state: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      delivery_detail: { type: Sequelize.STRING(500), allowNull: true },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The thread read, and the ordering FR-092 requires.
    await queryInterface.addIndex('messages', ['ticket_id', 'occurred_at'], {
      name: 'messages_ticket_occurred',
    });

    await queryInterface.addIndex('messages', ['channel', 'provider_message_id'], {
      name: 'messages_provider',
    });

    // The threading lookup. UNIQUE is the correctness constraint, not a hint.
    await queryInterface.addIndex('messages', ['outbound_message_id'], {
      name: 'messages_outbound_message_id',
      unique: true,
    });
  },

  async down(queryInterface) {
    // Indexes before the table, and the table before anything referencing it —
    // the ordering failure Phase 1 hit and every phase since has re-checked.
    await queryInterface.removeIndex('messages', 'messages_outbound_message_id');
    await queryInterface.removeIndex('messages', 'messages_provider');
    await queryInterface.removeIndex('messages', 'messages_ticket_occurred');
    await queryInterface.dropTable('messages');
  },
};
