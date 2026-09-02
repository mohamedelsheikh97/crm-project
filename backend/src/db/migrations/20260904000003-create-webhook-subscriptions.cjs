'use strict';

/**
 * Where notifications go, and what they are for (Phase 11, FR-024 - FR-038).
 *
 * IT BELONGS TO AN `api_client`, NOT TO A USER, AND THAT IS LOAD-BEARING.
 *
 * FR-037 says an event must not be delivered to a subscriber whose credential
 * does not cover the record — because the notification itself discloses that the
 * record exists. "Ticket 421 was resolved" tells the receiver there is a ticket
 * 421. Hanging the subscription off the credential is what makes that checkable:
 * at delivery time there is an authority to consult. Hanging it off a user would
 * mean either checking a person's authority for a machine's delivery, or not
 * checking at all.
 *
 * `health` IS AN ENUM, NOT A BOOLEAN OR A COLOUR. FR-058 wants an administrator
 * to see health without inferring it from a list of failures, and FR-064 forbids
 * conveying it by colour alone. Storing the state as data means the label is
 * translated text and the icon is chosen from the value — a green dot cannot
 * become the only carrier of meaning, because there is a word beside it by
 * construction.
 *
 * TWO SIGNING-SECRET COLUMNS RATHER THAN A TABLE, unlike the credential's
 * secrets. Deliberate asymmetry: a credential's rotation is an operational event
 * with its own lifecycle and may legitimately overlap more than twice, whereas a
 * subscription's signature only ever needs "current and one previous". A table
 * would be more machinery than the requirement asks for.
 *
 * The URL is validated publicly-routable at save AND AGAIN at delivery
 * (FR-034). A hostname that resolved publicly when saved can be repointed at
 * 127.0.0.1 afterwards, and a save-time-only check does not see that.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('webhook_subscriptions', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      api_client_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'api_clients', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      url: { type: Sequelize.STRING(2048), allowNull: false },
      // The event types this subscription asked for. A subscriber must not
      // receive events it did not ask for (FR-025), and a new type added later
      // is therefore not a breaking change for anybody.
      event_types: { type: Sequelize.JSON, allowNull: false },
      // SHA-256, on the same basis as a credential secret: shown once at
      // creation, verifiable but not retrievable.
      signing_secret_hash: { type: Sequelize.CHAR(64), allowNull: false },
      // Valid during a rotation overlap, so a receiver can redeploy without
      // dropping notifications in between (FR-038).
      previous_signing_secret_hash: { type: Sequelize.CHAR(64), allowNull: true },
      secret_rotated_at: { type: Sequelize.DATE, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      health: {
        type: Sequelize.ENUM('healthy', 'degraded', 'failing', 'unknown'),
        allowNull: false,
        defaultValue: 'unknown',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The delivery fan-out reads active subscriptions; the overview reads by
    // client. One index serves both.
    await queryInterface.addIndex('webhook_subscriptions', ['api_client_id', 'is_active'], {
      name: 'webhook_subscriptions_client_active',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('webhook_subscriptions');
  },
};
