'use strict';

const bcrypt = require('bcrypt');

const SEED_EMAIL = 'admin@crm.local';
const SEED_PASSWORD = 'ChangeMe123!';
const BCRYPT_COST = 12;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // This account must not exist anywhere but a developer machine.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      console.warn(
        `Skipping ${SEED_EMAIL} seed: NODE_ENV is "${process.env.NODE_ENV}", not "development".`,
      );
      return;
    }

    // Idempotent: re-running must neither duplicate nor error (data-model.md).
    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM users WHERE email = :email LIMIT 1',
      { replacements: { email: SEED_EMAIL } },
    );

    if (existing.length > 0) {
      console.log(`${SEED_EMAIL} already exists; nothing to do.`);
      return;
    }

    const [adminRole] = await queryInterface.sequelize.query(
      "SELECT id FROM roles WHERE `key` = 'admin' LIMIT 1",
    );

    if (adminRole.length === 0) {
      throw new Error('The admin role is missing; run migrations before seeding.');
    }

    const now = new Date();

    await queryInterface.bulkInsert('users', [
      {
        email: SEED_EMAIL,
        full_name: 'System Administrator',
        password_hash: await bcrypt.hash(SEED_PASSWORD, BCRYPT_COST),
        // An ordinary Administrator holding no privilege outside the role
        // system (FR-049).
        role_id: adminRole[0].id,
        is_active: true,
        // Set here, but deliberately NOT backfilled onto pre-existing rows by
        // the migration, so an established development environment keeps
        // working (data-model.md).
        must_change_password: true,
        failed_login_attempts: 0,
        locked_until: null,
        version: 0,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('users', { email: SEED_EMAIL });
  },
};
