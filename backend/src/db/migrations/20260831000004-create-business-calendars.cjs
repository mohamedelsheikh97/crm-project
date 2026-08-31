'use strict';

/**
 * What a working hour is (Phase 6, Clarifications Q1, FR-025a, FR-026).
 *
 * Clarifications Q1 decided SLA durations are WORKING time, not wall-clock.
 * That decision is worth nothing without somewhere to say which hours those
 * are, and FR-026 requires an administrator to be able to change it rather than
 * inherit an assumption.
 *
 * HOURS ARE MINUTES FROM LOCAL MIDNIGHT, NOT A `TIME` COLUMN. The arithmetic in
 * lib/business-hours.ts works in minutes; a TIME column round-tripped through
 * Sequelize arrives as a string that every caller would have to parse
 * identically, and one caller eventually would not.
 *
 * DAYS ARE A 7-BIT MASK, SUNDAY = BIT 0. Every consumer wants the set rather
 * than one day, and a mask makes "no working days at all" a single check the
 * validator can refuse — which matters, because a calendar with no working days
 * makes every target unreachable and would spin the day walk to its bound.
 *
 * The default is Sunday-Thursday, 09:00-17:00, Africa/Cairo (Clarifications
 * Q1). It is an ASSUMPTION, not a discovered fact, and it is the first thing a
 * real installation should change.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('business_calendars', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: { type: Sequelize.STRING(120), allowNull: false },
      // An IANA zone name, validated by round-tripping it through
      // Intl.DateTimeFormat at the API boundary — so an unknown zone is refused
      // where a person can read the error, never inside a sweep at 02:00.
      time_zone: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'Africa/Cairo' },
      // 31 = 0b0011111 = Sun..Thu, with Sunday as bit 0. (62 would be Mon..Fri —
      // the two differ by exactly the mistake this comment exists to prevent.)
      working_days: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 31 },
      day_start_minute: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 540 },
      day_end_minute: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1020 },
      // Exactly one active row, enforced in the service rather than by a
      // constraint: MySQL cannot express "at most one row where is_active", and
      // a partial unique index would be a lie in a portable schema.
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      updated_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('business_calendars', ['is_active'], {
      name: 'business_calendars_active',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('business_calendars', 'business_calendars_active');
    await queryInterface.dropTable('business_calendars');
  },
};
