'use strict';

/**
 * Default grants for the Phase 4 dashboard modules.
 *
 * RECONCILING, never replacing: it inserts grants that are missing and never
 * deletes existing rows, so re-running cannot wipe an Administrator's
 * deliberate changes. Same contract as the Phase 1, 2, and 3 seeders.
 *
 * Keep in step with backend/src/auth/permissions.ts. The generated matrix test
 * catches drift — a catalog key with no grant, or a grant nothing enforces,
 * fails the build.
 *
 * @type {import('sequelize-cli').Migration}
 */
const AGENT_GRANTS = [
  // Own queue, own notifications, own tasks.
  'dashboard:view',
  // Deliberate: a due date in this phase is a promise the person doing the work
  // made, and Phase 3 already trusts an Agent to resolve and close. The key
  // exists so the authority is SEPARABLE (FR-075), not because it is withheld.
  'tickets:set_due_date',
  'ticket_notes:create',
  'tasks:manage',
  'templates:use',
];

const SUPERVISOR_GRANTS = [
  ...AGENT_GRANTS,
  // Looking at another agent's workload is supervision, not everyday work.
  'dashboard:view_any',
  // Editing someone else's note is a correction of the record.
  'ticket_notes:manage',
  // Changing the library changes it for everyone.
  'templates:manage',
];

// Administrators hold every catalog key, so this list is the Phase 4 addition
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
      console.log('Dashboard permissions already reconciled; nothing to do.');
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
