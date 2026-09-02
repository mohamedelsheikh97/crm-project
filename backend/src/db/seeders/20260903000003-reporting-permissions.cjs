'use strict';

/**
 * Default grants for Phase 10 — Reports & Management.
 *
 * RECONCILING, never replacing: inserts what is missing and deletes nothing, so
 * re-running cannot wipe an Administrator's deliberate changes. Same contract as
 * the Phase 1-9 seeders.
 *
 * Keep in step with backend/src/auth/permissions.ts. The generated matrix test
 * catches drift — a catalog key with no grant, or a grant nothing enforces,
 * fails the build.
 *
 * SUPERVISORS GET ALL THREE, and that is a wider grant than Phase 9 gave for
 * `ai:manage`. The reasoning differs because the risk differs: switching an AI
 * feature on changes what the system DOES to every future ticket, whereas
 * reading a report changes nothing. Operational visibility is the everyday work
 * of a supervisor, and a reporting phase whose reports only administrators could
 * read would not serve the people PLAN.md names — "operational visibility for
 * supervisors and management".
 *
 * NOTHING FOR AGENTS, INCLUDING `reports:view`. That is narrower than it might
 * look and it is deliberate:
 *
 *   - `reports:view_agents` is Clarifications Q1: agent figures are supervisory,
 *     and an agent cannot see even their own.
 *   - `reports:view` is withheld because the operational reports aggregate the
 *     whole team's work. An agent who can see team-wide volume, SLA breach
 *     counts and CSAT by category can infer a good deal about colleagues'
 *     performance without ever opening the agent report — which is exactly the
 *     aggregation-inference route FR-061 exists to close. Granting it would make
 *     Q1's decision cosmetic.
 *   - `reports:export` follows from having nothing to export.
 *
 * An agent who needs a figure asks their supervisor, which is a conversation
 * rather than an obstacle — and it is the same conversation FR-034's
 * traceability exists to make answerable.
 *
 * @type {import('sequelize-cli').Migration}
 */
const SUPERVISOR_GRANTS = ['reports:view', 'reports:view_agents', 'reports:export'];

// Administrators hold every catalog key; this is the Phase 10 addition rather
// than the complete set.
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
    // Removes only the keys this seeder introduces. A blanket delete would take
    // an Administrator's own additions with it.
    await queryInterface.bulkDelete('role_permissions', {
      permission_key: {
        [Sequelize.Op.in]: ['reports:view', 'reports:view_agents', 'reports:export'],
      },
    });
  },
};
