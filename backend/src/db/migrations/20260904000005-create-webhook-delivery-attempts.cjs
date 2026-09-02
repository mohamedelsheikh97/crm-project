'use strict';

/**
 * One row per delivery attempt (Phase 11, FR-030, FR-033, FR-059, FR-060).
 *
 * ATTEMPTS ARE ROWS, NOT A COUNTER ON THE EVENT. A counter answers "how many
 * times did we try?"; rows answer "what happened each time, and why?" — which is
 * the question FR-060 requires an administrator to be able to act on. "Delivery
 * failed 6 times" is not actionable; "TLS certificate expired" is.
 *
 * THE STATE MACHINE IS ENFORCED BY THE INDEX, NOT BY A CHECK.
 * A `pending` row always has `next_attempt_at`; a terminal row never does. That
 * invariant is what makes the sweep's query a single index range rather than a
 * scan with conditions — `(state, next_attempt_at)` covers exactly "what is due
 * now".
 *
 * CLAIMING IS A CONDITIONAL UPDATE, not a read-then-write, so two ticks within
 * one process cannot both take the same attempt. It does not solve the
 * multi-process case: the existing scheduler's own comment records that two
 * processes would double-fire, and here the duplicate leaves the building. That
 * is why FR-031 makes at-least-once part of the PUBLISHED contract — a receiver
 * is required to deduplicate, so a double-fire is survivable rather than
 * corrupting. A lock is the real answer and it is out of scope for this phase.
 *
 * `abandoned` MEANS EXHAUSTED, AND THE ROW IS KEPT (FR-033). Nothing here is
 * deleted when delivery gives up: an event that vanished at that moment is the
 * failure nobody notices, which is the whole reason User Story 6 exists.
 *
 * `resent_by_user_id` DISTINGUISHES A RE-SEND FROM A RETRY. Both produce an
 * attempt; only one of them is somebody's decision, and FR-059 requires that to
 * be attributable.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('webhook_delivery_attempts', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      event_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'integration_events', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      subscription_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'webhook_subscriptions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      attempt_number: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
      state: {
        type: Sequelize.ENUM('pending', 'succeeded', 'failed', 'abandoned'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // Set when pending, NULL otherwise. See the invariant note above.
      next_attempt_at: { type: Sequelize.DATE, allowNull: true },
      response_status: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
      // A phrase for a human, distinct from the status code. Both are recorded
      // because "500" and "the receiver returned a redirect" need different
      // actions from the administrator reading them.
      failure_reason: { type: Sequelize.STRING(255), allowNull: true },
      resent_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      attempted_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // THE SWEEP'S ONLY QUERY. Every tick is one index range on this.
    await queryInterface.addIndex('webhook_delivery_attempts', ['state', 'next_attempt_at'], {
      name: 'webhook_attempts_due',
    });

    // Health derivation and the overview read recent attempts per subscription.
    await queryInterface.addIndex(
      'webhook_delivery_attempts',
      ['subscription_id', 'created_at'],
      { name: 'webhook_attempts_subscription' },
    );

    // "Has this event been delivered to this subscription?" — asked once per
    // event per subscription during fan-out, so it must not be a scan.
    await queryInterface.addIndex('webhook_delivery_attempts', ['event_id', 'subscription_id'], {
      name: 'webhook_attempts_event_subscription',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('webhook_delivery_attempts');
  },
};
