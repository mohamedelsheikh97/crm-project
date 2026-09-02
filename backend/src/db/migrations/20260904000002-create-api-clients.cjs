'use strict';

/**
 * Machine credentials for the published interface (Phase 11, FR-014 - FR-023).
 *
 * THREE TABLES, AND THE SPLIT IS THE POINT.
 *
 * `api_clients` HAS NO SECRET COLUMN. Secrets live in `api_client_secrets`, one
 * row each, because FR-018 requires rotation to cause no failed request — and
 * the only way to guarantee that is for the outgoing and incoming secrets to be
 * valid at the same time. An integrator cannot atomically redeploy in step with
 * our update. Rows rather than a `secret_hash` / `previous_secret_hash` pair
 * because rows make expiry per-secret, and make a third overlapping secret a
 * data question rather than a schema change.
 *
 * THE HASH IS SHA-256, NOT BCRYPT, and that will look wrong to a reviewer. The
 * rule it is reaching for applies to PASSWORDS: low-entropy secrets a human
 * chose, where a slow KDF is what makes an offline dictionary attack
 * impractical. A 32-byte random secret has no dictionary. There is nothing to
 * slow down, and bcrypt at this project's password cost factor would add roughly
 * 100ms of CPU to EVERY API REQUEST — turning a deliberate anti-brute-force cost
 * into a self-inflicted throughput ceiling on the one surface designed for
 * volume. Phase 8 stores portal invitation tokens the same way for the same
 * reason. See research.md D3.
 *
 * `api_client_permissions` MIRRORS `role_permissions` DELIBERATELY. FR-015 asks
 * for one permission vocabulary rather than a parallel "scope" system, so the
 * existing authorization matrix covers machine credentials too. A parallel
 * vocabulary would need every future permission added in two places, and the
 * failure mode is a scope that looks granted and is not.
 *
 * `last_used_at` IS WRITTEN ON A READ PATH, which is a deliberate cost. It is
 * what makes FR-022 answerable, and "which of these forty credentials is still
 * in use?" is the question that precedes every credential cleanup. Without the
 * column the answer requires reading the audit log.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('api_clients', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      /**
       * The public half of the credential, travelling in every request and
       * appearing in audit records. Generated, non-guessable, and prefixed so an
       * administrator can match a leaked credential's visible half to a record
       * without ever holding the secret.
       */
      client_id: { type: Sequelize.STRING(40), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      /**
       * SET NULL rather than CASCADE: the credential outlives the administrator
       * who issued it, and deleting a person must not silently revoke an
       * integration. FR-023's rule is that revoking a person revokes the person.
       */
      created_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      last_used_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('api_client_secrets', {
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
      // SHA-256 hex of 32 random bytes. NEVER the secret itself — the system can
      // verify a presented secret and cannot reveal the stored one (FR-017).
      secret_hash: { type: Sequelize.CHAR(64), allowNull: false },
      // NULL means current. Rotation sets the outgoing row to now + overlap.
      expires_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The authentication path's only index: look up by client, filter by expiry.
    await queryInterface.addIndex('api_client_secrets', ['api_client_id', 'expires_at'], {
      name: 'api_client_secrets_client_expiry',
    });

    await queryInterface.createTable('api_client_permissions', {
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
      // A key from the existing catalog in backend/src/auth/permissions.ts.
      // Not a foreign key: permissions are code, not rows, exactly as
      // `role_permissions` treats them.
      permission_key: { type: Sequelize.STRING(100), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('api_client_permissions', ['api_client_id', 'permission_key'], {
      unique: true,
      name: 'api_client_permissions_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('api_client_permissions');
    await queryInterface.dropTable('api_client_secrets');
    await queryInterface.dropTable('api_clients');
  },
};
