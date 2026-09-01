'use strict';

/**
 * A guide: an ordered series of articles on one subject (Phase 7,
 * Clarifications Q2).
 *
 * A GUIDE HAS NO STATUS OF ITS OWN, and the absence is deliberate. FR-011d says
 * a guide with no reader-visible articles is not offered, which is DERIVED from
 * its steps rather than stored — a stored flag would go stale the moment a step
 * was archived, and nothing would notice.
 *
 * Compare `kb_articles.status`, which IS stored because an article's visibility
 * is a decision somebody made. A guide's visibility is a consequence.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('kb_guides', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      title_en: { type: Sequelize.STRING(200), allowNull: true },
      title_ar: { type: Sequelize.STRING(200), allowNull: true },
      slug: { type: Sequelize.STRING(180), allowNull: false, unique: true },
      // Internal by default, matching articles: the safe default for content
      // nobody has considered is "colleagues only".
      audience: {
        type: Sequelize.ENUM('internal', 'customer'),
        allowNull: false,
        defaultValue: 'internal',
      },
      position: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('kb_guides', ['position', 'id'], {
      name: 'kb_guides_position',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('kb_guides', 'kb_guides_position');
    await queryInterface.dropTable('kb_guides');
  },
};
