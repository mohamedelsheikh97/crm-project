'use strict';

const bcrypt = require('bcrypt');

const SEED_EMAIL = 'admin@crm.local';
const SEED_PASSWORD = 'ChangeMe123!';
const BCRYPT_COST = 12;

/** True for a unique-constraint violation, whatever wrapper Sequelize used. */
function isDuplicateEntry(error) {
  return (
    error?.name === 'SequelizeUniqueConstraintError' ||
    error?.parent?.code === 'ER_DUP_ENTRY' ||
    error?.original?.code === 'ER_DUP_ENTRY'
  );
}

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
    //
    // THIS CHECK IS AN OPTIMISATION, NOT THE GUARANTEE.
    //
    // The distinction became visible in Phase 6, after an INTERRUPTED test run
    // left MySQL connections holding open transactions. MySQL's default
    // isolation is REPEATABLE READ, so a pooled connection carrying an older
    // read snapshot does not see a row another connection has written: this
    // check passes, and the insert below then collides with the real unique
    // index. Every test in the file afterwards fails with a 403 or 401 that
    // looks nothing like its cause, because the seeder chain aborted before
    // granting any permissions.
    //
    // So the check stays — it avoids hashing a password we would throw away —
    // and the catch below is what makes the promise in the first line of this
    // comment true in the awkward cases too. The unique index is the guarantee;
    // the SELECT is only a shortcut.
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

    try {
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
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;

      // Somebody else got there first, or this connection could not see them.
      // Either way the account exists, which is all this seeder wanted.
      console.log(`${SEED_EMAIL} already exists; nothing to do.`);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('users', { email: SEED_EMAIL });
  },
};
