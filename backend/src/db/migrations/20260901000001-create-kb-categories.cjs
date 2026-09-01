'use strict';

/**
 * The knowledge base's own filing structure (Phase 7, Clarifications Q2).
 *
 * SEPARATE FROM PHASE 3's TICKET CATEGORIES, and deliberately so. A ticket
 * category describes what somebody asked about; a knowledge category describes
 * how the organisation files what it knows. They overlap but are not the same
 * list, and forcing one onto the other would mean every new article had to
 * pretend to be a support request.
 *
 * `ticket_category` below is the STATED relationship between the two (FR-040,
 * research D6) — a boost when suggesting, never a filter.
 *
 * FLAT, NOT A TREE (spec Assumptions). There is no `parent_id`, and its absence
 * is a decision rather than an omission: a help centre that needs three levels
 * of hierarchy on its first day has a content problem rather than a software
 * one. A self-join is an additive migration if that turns out to be wrong.
 *
 * Names are stored PER LANGUAGE rather than as an i18n key (FR-012). An
 * administrator creates a category at runtime and cannot add a key to a locale
 * file, so the name is data — the same argument Phase 4 made for reply
 * templates and Phase 5 for form field labels.
 *
 * NO DESTROY PATH WHILE ARTICLES REFERENCE IT. The foreign key from
 * `kb_articles` is RESTRICT and the service refuses the delete with the count
 * (FR-015), so an article can never be orphaned into unbrowsability.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('kb_categories', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // At least one of the two is required, enforced in the service so the
      // message can say which one is missing.
      name_en: { type: Sequelize.STRING(120), allowNull: true },
      name_ar: { type: Sequelize.STRING(120), allowNull: true },
      // Public URLs address a category by slug, for the reason articles do
      // (research D10): a sequential id in a public URL discloses the size of
      // the corpus and lets a stranger walk it.
      slug: { type: Sequelize.STRING(140), allowNull: false, unique: true },
      // Null means "relates to no particular ticket category", which is the
      // honest answer for a category like "Getting started". Validated against
      // TICKET_CATEGORIES in the service rather than by an ENUM, so adding a
      // ticket category in a later phase needs no migration here.
      ticket_category: { type: Sequelize.STRING(30), allowNull: true },
      // Browse order is an editorial decision, not an alphabetical accident.
      position: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The browse query, in the order a reader meets them.
    await queryInterface.addIndex('kb_categories', ['position', 'id'], {
      name: 'kb_categories_position',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('kb_categories', 'kb_categories_position');
    await queryInterface.dropTable('kb_categories');
  },
};
