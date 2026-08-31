'use strict';

/**
 * Dated non-working days (Phase 6, FR-027).
 *
 * A SEPARATE TABLE FROM `business_calendars` because it is a GROWING LIST, not
 * a setting. Working hours are edited once a year; holidays are added every
 * time one is announced, and a JSON array on the calendar row would be rewritten
 * wholesale on each addition and could not be range-scanned by the arithmetic.
 *
 * `exception_date` IS A LOCAL DATE IN THE CALENDAR'S ZONE, NOT AN INSTANT. A
 * public holiday is "the 21st", not "midnight UTC on the 21st" — storing an
 * instant would make the holiday land on the wrong day for half the zones this
 * calendar could be configured with.
 *
 * FULL DAYS ONLY. Half-days were considered and are not built: FR-027 asks that
 * a public holiday does not consume a target, and a half-day is unrequested
 * complexity the constitution's YAGNI rule prohibits.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('calendar_exceptions', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      calendar_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'business_calendars', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      exception_date: { type: Sequelize.DATEONLY, allowNull: false },
      // Display only. "Eid al-Fitr" is a label, not a rule.
      label: { type: Sequelize.STRING(120), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // One row per date per calendar. Two rows for the same holiday would make
    // it count twice in any future aggregate and mean nothing to the day walk,
    // which only asks "is this date excluded?".
    await queryInterface.addIndex('calendar_exceptions', ['calendar_id', 'exception_date'], {
      name: 'calendar_exceptions_date',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('calendar_exceptions', 'calendar_exceptions_date');
    await queryInterface.dropTable('calendar_exceptions');
  },
};
