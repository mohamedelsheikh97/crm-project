'use strict';

/**
 * Who hears about what, by default (Phase 6, FR-079), and the single
 * assignment-settings row.
 *
 * THE SHAPE OF THE DEFAULTS: in-app everywhere, email only where somebody needs
 * to act away from the screen. A fresh installation should ALERT WITHOUT
 * SHOUTING — an installation that emails a supervisor about every approaching
 * target teaches them to filter the alerts, and then the breach arrives in the
 * same filtered folder.
 *
 * SMS IS OFF EVERYWHERE by default. It costs money per message and reaches
 * people outside working hours; turning it on is a decision an organisation
 * makes deliberately, not one a seeder makes for them.
 *
 * ASSIGNMENT IS SEEDED `off`, and this is the more consequential of the two
 * defaults in this file. Automatic assignment changes WHO DOES THE WORK. A
 * fresh installation must not start redistributing tickets because a seeder
 * ran; a supervisor turns it on when they have decided that is what they want.
 *
 * RECONCILING: inserts only what is absent. Re-running cannot undo an
 * administrator's changes.
 *
 * @type {import('sequelize-cli').Migration}
 */

// Supervisor is the role FR-041 means by "the supervisory recipients". There
// are no teams until Phase 12, so this is the narrowest correct audience.
const SUPERVISOR_ROLE_KEY = 'supervisor';

module.exports = {
  async up(queryInterface) {
    const [roles] = await queryInterface.sequelize.query(
      'SELECT id, `key` FROM roles WHERE `key` = :key',
      { replacements: { key: SUPERVISOR_ROLE_KEY } },
    );

    const supervisorRoleId = roles[0]?.id ?? null;
    const now = new Date();

    const desired = [
      // A breach is the event this phase exists for: the assignee sees it in
      // the application, and a supervisor is emailed because a breached ticket
      // is somebody's problem whether or not they are logged in.
      { event_key: 'sla.resolution_breached', recipient_kind: 'assignee', by_email: false },
      { event_key: 'sla.resolution_breached', recipient_kind: 'role', by_email: true },
      { event_key: 'sla.response_breached', recipient_kind: 'assignee', by_email: false },
      { event_key: 'sla.response_breached', recipient_kind: 'role', by_email: true },

      // At-risk is a nudge to the person who can still fix it, and ONLY to
      // them. Copying a supervisor on every approaching target is how an alert
      // becomes noise.
      { event_key: 'sla.resolution_at_risk', recipient_kind: 'assignee', by_email: false },
      { event_key: 'sla.response_at_risk', recipient_kind: 'assignee', by_email: false },

      // Nobody eligible to take a ticket is a staffing problem, so it goes to
      // a supervisor and never to an assignee — there isn't one (FR-048).
      { event_key: 'assignment.failed', recipient_kind: 'role', by_email: true },
    ];

    const [existing] = await queryInterface.sequelize.query(
      'SELECT event_key, recipient_kind, role_id FROM alert_subscriptions',
    );
    const held = new Set(
      existing.map((row) => `${row.event_key}:${row.recipient_kind}:${row.role_id ?? ''}`),
    );

    const rows = [];

    for (const entry of desired) {
      const roleId = entry.recipient_kind === 'role' ? supervisorRoleId : null;

      // A role subscription with no role to point at would be a row that can
      // never deliver. Skip it rather than store it.
      if (entry.recipient_kind === 'role' && roleId === null) continue;
      if (held.has(`${entry.event_key}:${entry.recipient_kind}:${roleId ?? ''}`)) continue;

      rows.push({
        event_key: entry.event_key,
        recipient_kind: entry.recipient_kind,
        role_id: roleId,
        // Always true and not adjustable (FR-073). Stored so the screen can
        // render an always-on disabled control rather than hide the transport.
        in_app: true,
        by_email: entry.by_email,
        by_sms: false,
        created_at: now,
        updated_at: now,
      });
    }

    if (rows.length > 0) {
      await queryInterface.bulkInsert('alert_subscriptions', rows);
    }

    const [settings] = await queryInterface.sequelize.query(
      'SELECT id FROM assignment_settings LIMIT 1',
    );

    if (settings.length === 0) {
      await queryInterface.bulkInsert('assignment_settings', [
        {
          strategy: 'off',
          max_open_per_agent: null,
          round_robin_cursor_user_id: null,
          updated_by_user_id: null,
          version: 0,
          created_at: now,
          updated_at: now,
        },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('alert_subscriptions', {});
    await queryInterface.bulkDelete('assignment_settings', {});
  },
};
