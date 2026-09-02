'use strict';

/**
 * Default grants for Phase 11 — Integrations.
 *
 * RECONCILING, never replacing: inserts what is missing and deletes nothing, so
 * re-running cannot wipe an Administrator's deliberate changes. Same contract as
 * the Phase 1-10 seeders.
 *
 * Keep in step with backend/src/auth/permissions.ts. The generated matrix test
 * catches drift — a catalog key with no grant, or a grant nothing enforces,
 * fails the build. Phase 10 discovered that `ai:manage` had neither a probe nor a
 * conditional entry and that suite had been failing since the phase that
 * introduced it, so both keys here get their probe in the same change.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMINISTRATOR ONLY. NOT SUPERVISORS — narrower than Phase 10 went.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 10 granted its three reporting keys to supervisors as well, on the
 * reasoning that reading a report changes nothing and operational visibility is
 * everyday supervisory work. Both halves of that argument fail here:
 *
 *   - `integrations:manage` issues credentials. A credential is a standing grant
 *     of read access to this organisation's customer and ticket data, handed to
 *     a party outside it, which will keep working until somebody revokes it. The
 *     failure mode is not a wrong number on a screen; it is a data flow nobody
 *     notices for a year.
 *   - `erp:sync` authorises the only external writer in the system. FR-043's
 *     failure — an agent's correction silently replaced by an ERP value — is
 *     invisible on every screen, so the decision to run one is not routine.
 *
 * A supervisor who needs a sync run or a credential issued asks an
 * administrator. That is a conversation, and for an action with this shape a
 * conversation is the right amount of friction.
 *
 * @type {import('sequelize-cli').Migration}
 */

// Administrators hold every catalog key; this is the Phase 11 addition rather
// than the complete set.
const ADMIN_GRANTS = ['integrations:manage', 'erp:sync'];

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
    } else {
      console.log('Integration permissions already reconciled; nothing to do.');
    }
  },

  async down(queryInterface, Sequelize) {
    // Removes only the keys this seeder introduces. A blanket delete would take
    // an Administrator's own additions with it.
    await queryInterface.bulkDelete('role_permissions', {
      permission_key: { [Sequelize.Op.in]: ADMIN_GRANTS },
    });
  },
};
