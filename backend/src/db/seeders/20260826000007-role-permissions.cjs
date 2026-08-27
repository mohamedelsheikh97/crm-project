'use strict';

/**
 * Default grants per role. Unlike the roles themselves, grants ARE mutable —
 * Administrators edit them at runtime — so they live in a seeder rather than a
 * migration.
 *
 * This seeder RECONCILES rather than replaces: it inserts grants that are
 * missing and never deletes existing rows. That matters because a later phase
 * adds catalog entries, and re-running this must not wipe an Administrator's
 * deliberate changes.
 *
 * Keep in step with backend/src/auth/permissions.ts. The matrix test asserts
 * every catalog key is enforced by some route, which is what catches drift.
 *
 * @type {import('sequelize-cli').Migration}
 */
const ALL_PERMISSIONS = [
  'users:view',
  'users:create',
  'users:update',
  'users:deactivate',
  'users:reset_password',
  'roles:view',
  'roles:update_permissions',
  'audit:view',
  'settings:view',
];

const DEFAULT_GRANTS = {
  admin: ALL_PERMISSIONS,
  supervisor: ['users:view', 'audit:view', 'settings:view'],
  // Agents administer nothing in this phase.
  agent: [],
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
      for (const permissionKey of DEFAULT_GRANTS[role.key] ?? []) {
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
      console.log('Role permissions already reconciled; nothing to do.');
      return;
    }

    await queryInterface.bulkInsert('role_permissions', rows);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('role_permissions', null, { truncate: true });
  },
};
