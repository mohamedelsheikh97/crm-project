'use strict';

/**
 * Signing secrets are ENCRYPTED, not hashed (Phase 11, FR-027, FR-038).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CORRECTING A DESIGN ERROR IN 20260904000003, AND RECORDING WHY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That migration created `signing_secret_hash` and
 * `previous_signing_secret_hash`, by analogy with `api_client_secrets` — where a
 * SHA-256 digest is exactly right because the client holds the secret and this
 * system only ever verifies what they present.
 *
 * A webhook signing secret is the other way round. THIS system signs; the
 * subscriber verifies. HMAC needs the key material, and a digest cannot produce
 * a signature — so a hashed signing secret is not a stricter version of the same
 * design, it is a design that cannot sign anything.
 *
 * The two cases look identical until you ask who verifies, which is why this
 * correction is a migration with an explanation rather than an edit to the
 * original. Anybody reading the schema history should be able to see that the
 * asymmetry was noticed rather than that somebody changed their mind.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ENCRYPTED RATHER THAN PLAINTEXT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Plaintext would work and is what many systems do. AES-256-GCM with a key from
 * the environment is one step better for very little cost: a database dump alone
 * yields nothing, because the key lives beside the JWT secrets rather than in
 * the database. See `lib/secret-box.ts`.
 *
 * The columns are wide because the sealed form is `<iv>.<tag>.<ciphertext>` in
 * base64 — about 120 characters for a 32-byte secret, with room for a longer one.
 *
 * NO DATA MIGRATION. Any subscription created before this point holds a hash
 * that cannot sign, so there is nothing to preserve — its secret has to be
 * rotated, which is an action an administrator can take. Rather than leave such
 * a row half-working, `down` restores the old columns and `up` drops them.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('webhook_subscriptions', 'signing_secret_sealed', {
      type: Sequelize.STRING(512),
      allowNull: false,
      defaultValue: '',
    });

    await queryInterface.addColumn('webhook_subscriptions', 'previous_signing_secret_sealed', {
      type: Sequelize.STRING(512),
      allowNull: true,
    });

    await queryInterface.removeColumn('webhook_subscriptions', 'signing_secret_hash');
    await queryInterface.removeColumn('webhook_subscriptions', 'previous_signing_secret_hash');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('webhook_subscriptions', 'signing_secret_hash', {
      type: Sequelize.CHAR(64),
      allowNull: false,
      defaultValue: '',
    });

    await queryInterface.addColumn('webhook_subscriptions', 'previous_signing_secret_hash', {
      type: Sequelize.CHAR(64),
      allowNull: true,
    });

    await queryInterface.removeColumn('webhook_subscriptions', 'signing_secret_sealed');
    await queryInterface.removeColumn('webhook_subscriptions', 'previous_signing_secret_sealed');
  },
};
