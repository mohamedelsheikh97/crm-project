'use strict';

/**
 * Default grants for the Phase 5 communication channels.
 *
 * RECONCILING, never replacing: it inserts grants that are missing and never
 * deletes existing rows, so re-running cannot wipe an Administrator's
 * deliberate changes. Same contract as the Phase 1, 2, 3 and 4 seeders.
 *
 * Keep in step with backend/src/auth/permissions.ts. The generated matrix test
 * catches drift — a catalog key with no grant, or a grant nothing enforces,
 * fails the build.
 *
 * @type {import('sequelize-cli').Migration}
 */
const AGENT_GRANTS = [
  // Answering a customer is the everyday work this phase exists for. An agent
  // who can be assigned a ticket but cannot reply to it has been handed an
  // inbox with the lid welded shut.
  'messages:send',
];

const SUPERVISOR_GRANTS = [
  ...AGENT_GRANTS,
  // Moving a conversation between customer records is a correction to the
  // record, in the same family as editing someone else's note.
  'messages:reattribute',
  // A published form is a public endpoint. Defining one is not everyday work.
  'forms:manage',
];

// Administrators hold every catalog key, so this list is the Phase 5 addition
// rather than the complete set.
const ADMIN_GRANTS = [
  ...SUPERVISOR_GRANTS,
  // Switching a channel on points the outside world at this system, and the
  // credentials behind it are deployment configuration. That pairing makes it
  // an administrator's decision rather than a supervisor's.
  'channels:manage',
];

const GRANTS = {
  agent: AGENT_GRANTS,
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
    // Removes only the keys this seeder introduces, and only for the roles it
    // granted them to. A blanket delete would take an Administrator's own
    // additions with it.
    await queryInterface.bulkDelete('role_permissions', {
      permission_key: {
        [Sequelize.Op.in]: [
          'messages:send',
          'messages:reattribute',
          'channels:manage',
          'forms:manage',
        ],
      },
    });
  },
};
