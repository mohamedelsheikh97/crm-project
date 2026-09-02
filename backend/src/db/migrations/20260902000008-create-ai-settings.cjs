'use strict';

/**
 * Runtime AI configuration, single row (Phase 9, US6, FR-002, SC-021).
 *
 * WHY A TABLE AND NOT JUST THE ENVIRONMENT VARIABLES. FR-002 requires each
 * feature to be switchable by an administrator and SC-021 requires the surface
 * to disappear "within one page load". An environment variable cannot do that:
 * it needs a restart, it is not editable through a screen, and a change to it
 * is not auditable. Phase 6 settled this exact question for SLA policies and
 * the assignment strategy and wrote down the rule — env holds operational
 * tuning, anything an administrator edits at runtime with an audit entry is a
 * database row. This follows it.
 *
 * The env variables remain as the DEFAULTS this row is seeded from, so an
 * existing deployment behaves identically until somebody opens the screen.
 *
 * WHAT IS DELIBERATELY NOT IN THIS TABLE, and must never be added:
 *
 *   - the processing location of any feature
 *   - the external API key
 *   - the local base URL
 *
 * Those are compile-time and deployment concerns (research D2, FR-008a). A
 * `location` column here would be precisely the failure FR-008a exists to
 * prevent: the egress boundary reduced to a string one careless UPDATE away
 * from sending customer chat to a third party, with nothing failing and no
 * error raised. `backend/tests/ai/config-secrets.test.ts` asserts the column
 * list, so adding one fails a test rather than passing review.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ai_settings', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      summary_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      draft_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      classify_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      similar_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      assistant_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },

      // Daily ceilings. Editable because the right number is discovered from
      // real traffic (research open question 4), not chosen up front.
      ceiling_summary: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 500 },
      ceiling_draft: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 500 },
      ceiling_classify: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 2000 },
      ceiling_assistant: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 2000 },

      // Comma-separated, validated against ['ar','en'] on write. Editable
      // because D4 makes Arabic enablement a decision taken on evidence, and
      // that evidence arrives after deployment.
      assistant_langs: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'en' },

      // The number research open question 1 flags as the most consequential in
      // the phase, and the one every test passes at either extreme. It has to
      // be tunable without a deploy, or it will never be tuned.
      grounding_floor: { type: Sequelize.DECIMAL(4, 3), allowNull: false, defaultValue: 0.35 },

      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_settings');
  },
};
