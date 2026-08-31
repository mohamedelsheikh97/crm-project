'use strict';

/**
 * A customer's refusal to be messaged again (Phase 5, FR-051, FR-060, FR-065).
 *
 * KEYED BY IDENTITY, DELIBERATELY NOT BY CUSTOMER. This is the whole design.
 *
 * A person who replies STOP has refused messages to THAT NUMBER. That refusal
 * has to survive things the customer record does not:
 *
 *   - the number being moved from one customer to another
 *   - two customers being merged, or one being split out again
 *   - the customer record being deactivated, or the contact row deleted
 *   - a provisional customer created from that number later being merged away
 *
 * Keying on `customer_id` would let any of those quietly resurrect consent,
 * and the failure would be invisible until somebody who had asked to be left
 * alone received another message. Keying on the normalised identity means the
 * refusal outlives every customer-record change, because it was never about
 * the record.
 *
 * Normalisation is through lib/phone.ts, the single site — so +20 100 123 4567
 * and 01001234567 are the same refusal.
 *
 * NO `opted_in_at` AND NO DELETE PATH IN THE SERVICE. Re-consent is not
 * something an agent should be able to grant on a customer's behalf; it comes
 * back through the channel, from the person, which writes a new row after this
 * one is removed by a deliberate administrative act.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('channel_opt_outs', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      channel: { type: Sequelize.STRING(20), allowNull: false },
      // Through lib/phone.ts. Never the raw value: formatting must not be able
      // to defeat a refusal.
      identity_normalised: { type: Sequelize.STRING(255), allowNull: false },
      opted_out_at: { type: Sequelize.DATE, allowNull: false },
      // keyword | provider | agent
      source: { type: Sequelize.STRING(20), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // One refusal per identity per channel. The unique constraint also makes
    // recording an opt-out idempotent, which matters because a provider can
    // deliver the same STOP twice.
    await queryInterface.addIndex('channel_opt_outs', ['channel', 'identity_normalised'], {
      name: 'channel_opt_outs_identity',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('channel_opt_outs', 'channel_opt_outs_identity');
    await queryInterface.dropTable('channel_opt_outs');
  },
};
