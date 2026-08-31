'use strict';

/**
 * Which channels are switched on (Phase 5, FR-005).
 *
 * THERE IS NO CREDENTIAL COLUMN, AND THERE MUST NEVER BE ONE. FR-006 puts
 * secrets in environment configuration, unreadable through any interface, which
 * is how Phases 0-4 handle every other secret in this project. A row an
 * administrator can edit through a screen is the wrong home for an access token:
 * it turns a database read into a credential leak, and it puts the secret
 * somewhere a backup, a log, or an export can carry it.
 *
 * The PROVIDER is not here either. It lives in the environment because it
 * decides which code runs, and selecting code through a row an administrator
 * can edit is a larger blast radius than this phase needs.
 *
 * What IS here is enablement and non-secret settings — the things a person
 * genuinely needs to change at runtime without a deployment.
 *
 * Disabled by default, deliberately: a channel starts carrying real customer
 * conversations because somebody turned it on, not because a migration ran.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('channel_settings', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      channel: { type: Sequelize.STRING(20), allowNull: false },
      is_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // Non-secret knobs only: intake address, display name, greeting keys.
      // Validated against a per-channel allow-list in the service, which
      // refuses anything that looks like a credential rather than storing it.
      settings_json: { type: Sequelize.JSON, allowNull: true },
      updated_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // One row per channel. Two rows for `email` would mean two answers to
    // "is email on?", and something would read the wrong one.
    await queryInterface.addIndex('channel_settings', ['channel'], {
      name: 'channel_settings_channel',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('channel_settings', 'channel_settings_channel');
    await queryInterface.dropTable('channel_settings');
  },
};
