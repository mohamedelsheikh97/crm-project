'use strict';

/**
 * The `portal` channel's enablement row (Phase 8, research.md D6).
 *
 * The portal is the sixth channel, and it goes through `channel_settings` like
 * every other one — which is what gives an administrator a way to switch the
 * portal's conversation off without a deployment, using the screen they already
 * know.
 *
 * ENABLED by default, unlike Phase 5's channels. Those default to off because
 * each needs credentials before it can deliver anything, and a channel switched
 * on without them fails at the first message. The portal has no provider and no
 * credential: this system IS the provider, the same reasoning the registry
 * already records for `chat`. There is nothing to configure first, so shipping
 * it off would only mean a phase whose central feature does not work until
 * somebody finds the toggle.
 *
 * A MIGRATION rather than a seeder, deliberately. Seeders are re-runnable
 * fixtures; this row is a precondition for the reply path existing at all
 * (`conversationFor` needs it), so it belongs in the schema history where the
 * test database gets it automatically.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      "SELECT id FROM channel_settings WHERE channel = 'portal' LIMIT 1",
    );

    if (existing.length > 0) return;

    await queryInterface.bulkInsert('channel_settings', [
      {
        channel: 'portal',
        is_enabled: true,
        settings_json: null,
        updated_by_user_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('channel_settings', { channel: 'portal' });
  },
};
