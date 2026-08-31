'use strict';

/**
 * THE INTAKE LEDGER (Phase 5, research.md D13).
 *
 * One row per accepted delivery, written BEFORE conversion is attempted. Three
 * requirements that look separate are all this one table:
 *
 *   - IDEMPOTENCY (FR-007, FR-039, FR-055, FR-094) is the unique index below.
 *     Every channel gets it and none implements its own: a redelivered webhook,
 *     a re-read mailbox, a provider that retries because our response was slow,
 *     all collide on `(channel, provider_message_id)` and become a no-op.
 *   - NOTHING IS LOST (FR-037, FR-038) is `raw_payload` plus `status` plus
 *     `reason`. A delivery that cannot be parsed, attributed, or converted is
 *     still a row, still has what arrived, and can be processed again once the
 *     cause is fixed.
 *   - THE INTAKE AUDIT TRAIL (FR-101) is a query over it.
 *
 * Splitting these into a processed-ids table and a dead-letter table was
 * considered and rejected: a delivery that fails is exactly a delivery that was
 * seen, so the two tables would hold the same rows with different lifetimes and
 * drift apart the first time one write succeeded and the other did not.
 *
 * `ignored` IS NOT `failed`, and the distinction earns its place. An
 * out-of-office reply was recognised and deliberately not converted (FR-029);
 * it is not an error. Collapsing the two would fill an administrator's failure
 * review with correctly-handled automated mail, and the genuine failures — the
 * ones a customer is waiting on — would be lost in the noise.
 *
 * `converted` is terminal. Reprocessing a converted delivery would duplicate a
 * ticket, which is the exact thing this table exists to prevent.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('channel_intake', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      channel: { type: Sequelize.STRING(20), allowNull: false },
      // The provider's own identifier: a Message-ID for mail, an event id for a
      // webhook, a submission uuid for a form.
      provider_message_id: { type: Sequelize.STRING(255), allowNull: false },
      received_at: { type: Sequelize.DATE, allowNull: false },
      // pending | converted | ignored | failed
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      // Human-readable, shown to an administrator. Why it was ignored, or how
      // it failed.
      reason: { type: Sequelize.STRING(500), allowNull: true },
      // What actually arrived. This is what makes a failure reprocessable, so
      // it is retained even for deliveries that converted cleanly.
      raw_payload: { type: Sequelize.TEXT('medium'), allowNull: false },
      // Set when status becomes `converted`. SET NULL rather than CASCADE: if a
      // ticket and its messages are removed, the record that something arrived
      // must survive, or the ledger stops being a ledger.
      message_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'messages', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      attempts: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // THE CONSTRAINT THAT IS FR-039, FR-055 AND FR-094 AT ONCE.
    // Do not "optimise" this to a non-unique index.
    await queryInterface.addIndex('channel_intake', ['channel', 'provider_message_id'], {
      name: 'channel_intake_provider',
      unique: true,
    });

    // The administrator's review list: what failed, newest first.
    await queryInterface.addIndex('channel_intake', ['status', 'received_at'], {
      name: 'channel_intake_status',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('channel_intake', 'channel_intake_status');
    await queryInterface.removeIndex('channel_intake', 'channel_intake_provider');
    await queryInterface.dropTable('channel_intake');
  },
};
