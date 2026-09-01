'use strict';

/**
 * Default grants for Phase 8 — Customer Portal.
 *
 * RECONCILING, never replacing: it inserts grants that are missing and never
 * deletes existing rows, so re-running cannot wipe an Administrator's deliberate
 * changes. Same contract as the Phase 1-7 seeders.
 *
 * Keep in step with backend/src/auth/permissions.ts. The generated matrix test
 * catches drift — a catalog key with no grant, or a grant nothing enforces,
 * fails the build.
 *
 * NOTHING FOR AGENTS, and that is the decision worth defending. Inviting a
 * customer into the portal is not a step in working a ticket; it is deciding
 * that this person may read a stream of their organisation's correspondence from
 * outside the building. Withdrawing it is the only remedy when a credential is
 * shared or compromised. Both are supervisory judgements, and an agent who needs
 * one asks for it — which is a conversation, not an obstacle.
 *
 * The narrower reading was `portal:manage` for agents so they could invite the
 * customer they are already talking to. It was rejected because the same key
 * also releases lockouts and resets credentials, and there is no version of this
 * phase where "may invite" and "may reset somebody's password" are safely the
 * same grant for the widest role in the system.
 *
 * @type {import('sequelize-cli').Migration}
 */

const SUPERVISOR_GRANTS = ['portal:manage'];

// Administrators hold every catalog key, so this list is the Phase 8 addition
// rather than the complete set.
const ADMIN_GRANTS = [...SUPERVISOR_GRANTS];

const GRANTS = {
  supervisor: SUPERVISOR_GRANTS,
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
      permission_key: { [Sequelize.Op.in]: ['portal:manage'] },
    });
  },
};
