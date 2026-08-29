'use strict';

/**
 * Default grants for the Phase 3 ticket module.
 *
 * RECONCILING, never replacing: it inserts grants that are missing and never
 * deletes existing rows, so re-running cannot wipe an Administrator's
 * deliberate changes. Same contract as the Phase 1 and Phase 2 seeders.
 *
 * Keep in step with backend/src/auth/permissions.ts. The generated matrix test
 * catches drift — a catalog key with no grant, or a grant nothing enforces,
 * fails the build.
 *
 * @type {import('sequelize-cli').Migration}
 */
const AGENT_GRANTS = [
  'tickets:view',
  'tickets:create',
  'tickets:update',
  'tickets:transition',
  // An Agent closes their own resolved work. The service adds the ownership
  // condition; the key alone does not let them close another Agent's ticket
  // (Clarifications Q2).
  'tickets:close',
  'tickets:link',
];

const SUPERVISOR_GRANTS = [
  ...AGENT_GRANTS,
  // Reopening undoes completed work, so it needs more authority than closing
  // (Q2). Assignment is Supervisor-only, so an Agent cannot claim a ticket —
  // including for themselves (Q3).
  'tickets:reopen',
  'tickets:assign',
  'tickets:merge',
  'tickets:manage_any',
];

// Administrators hold every catalog key, so this list is the Phase 3 addition
// rather than the complete set.
const ADMIN_GRANTS = [...SUPERVISOR_GRANTS];

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

    if (rows.length === 0) {
      console.log('Ticket permissions already reconciled; nothing to do.');
      return;
    }

    await queryInterface.bulkInsert('role_permissions', rows);
  },

  async down(queryInterface) {
    const keys = [...new Set(Object.values(GRANTS).flat())];

    await queryInterface.bulkDelete('role_permissions', {
      permission_key: keys,
    });
  },
};
