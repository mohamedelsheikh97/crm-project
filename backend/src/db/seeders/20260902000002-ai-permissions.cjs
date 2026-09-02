'use strict';

/**
 * Default grants for Phase 9 — AI Features.
 *
 * RECONCILING, never replacing: inserts what is missing and deletes nothing, so
 * re-running cannot wipe an Administrator's deliberate changes. Same contract as
 * the Phase 1-8 seeders.
 *
 * Keep in step with backend/src/auth/permissions.ts. The generated matrix test
 * catches drift — a catalog key with no grant, or a grant nothing enforces,
 * fails the build.
 *
 * ADMINISTRATOR ONLY, and not supervisors — which is narrower than Phase 8 went
 * with `portal:manage`, deliberately.
 *
 * `ai:manage` is not "may use the AI features"; nobody needs a grant for that
 * (FR-061 binds usage to the underlying authority instead). It is the key that
 * decides whether the organisation transmits customer content to an external
 * provider at all, what it is willing to spend doing so, and whether a chatbot
 * speaks to customers in its name. It also opens the chatbot transcript review,
 * which is a window onto every customer conversation the machine has held.
 *
 * A supervisor who needs a feature switched on asks for it. That is a
 * conversation, not an obstacle — and the Phase 8 seeder's own argument, that
 * "may invite" and "may reset somebody's password" should not be the same grant
 * for the widest role, applies with more force to a key whose ceiling field is
 * the only thing between a misconfigured rule and an unbounded bill.
 *
 * @type {import('sequelize-cli').Migration}
 */

// Administrators hold every catalog key; this is the Phase 9 addition rather
// than the complete set.
const ADMIN_GRANTS = ['ai:manage'];

const GRANTS = {
  admin: ADMIN_GRANTS,
};

module.exports = {
  async up(queryInterface) {
    const [roles] = await queryInterface.sequelize.query('SELECT id, `key` FROM roles');
    const [existing] = await queryInterface.sequelize.query(
      'SELECT role_id, permission_key FROM role_permissions',
    );

    const held = new Set(existing.map((row) => `${row.role_id}:${row.permission_key}`));
    const now = new Date();
    const rows = [];

    for (const role of roles) {
      for (const permissionKey of GRANTS[role.key] ?? []) {
        if (held.has(`${role.id}:${permissionKey}`)) continue;

        rows.push({
          role_id: role.id,
          permission_key: permissionKey,
          created_at: now,
          updated_at: now,
        });
      }
    }

    if (rows.length > 0) {
      await queryInterface.bulkInsert('role_permissions', rows);
    }
  },

  async down(queryInterface, Sequelize) {
    // Removes only the key this seeder introduces. A blanket delete would take
    // an Administrator's own additions with it.
    await queryInterface.bulkDelete('role_permissions', {
      permission_key: { [Sequelize.Op.in]: ['ai:manage'] },
    });
  },
};
