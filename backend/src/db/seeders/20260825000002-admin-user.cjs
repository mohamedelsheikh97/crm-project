'use strict';

const bcrypt = require('bcrypt');

const SEED_EMAIL = 'admin@crm.local';
const SEED_PASSWORD = 'ChangeMe123!';
const BCRYPT_COST = 12;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // This account must not exist anywhere but a developer machine.
    if (process.env.NODE_ENV !== 'development') {
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

    const now = new Date();

    await queryInterface.bulkInsert('users', [
      {
        email: SEED_EMAIL,
        password_hash: await bcrypt.hash(SEED_PASSWORD, BCRYPT_COST),
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('users', { email: SEED_EMAIL });
  },
};
