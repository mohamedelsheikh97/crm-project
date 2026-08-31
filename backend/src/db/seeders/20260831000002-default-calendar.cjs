'use strict';

/**
 * The default business calendar (Phase 6, Clarifications Q1).
 *
 * Sunday-Thursday, 09:00-17:00, Africa/Cairo.
 *
 * THIS IS AN ASSUMPTION, NOT A DISCOVERED FACT. It is the first thing a real
 * installation should change, and quickstart.md lists confirming it with
 * whoever owns the SLA commitments as a manual task this phase cannot close by
 * itself. A default that is wrong for the organisation makes every target wrong
 * by the same amount, silently.
 *
 * NO HOLIDAY EXCEPTIONS ARE SEEDED. A holiday list is specific to a country,
 * a calendar, and often a year; guessing one would put wrong dates into the
 * arithmetic with no signal that anyone chose them.
 *
 * RECONCILING: creates the calendar only if none exists, so re-running cannot
 * overwrite an administrator's edited working week.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM business_calendars LIMIT 1',
    );

    if (existing.length > 0) return;

    const now = new Date();

    await queryInterface.bulkInsert('business_calendars', [
      {
        name: 'Default',
        time_zone: 'Africa/Cairo',
        // 0b0011111 — Sunday is bit 0, so this is Sun, Mon, Tue, Wed, Thu.
        working_days: 31,
        day_start_minute: 540, // 09:00
        day_end_minute: 1020, // 17:00
        is_active: true,
        updated_by_user_id: null,
        version: 0,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('business_calendars', { name: 'Default' });
  },
};
