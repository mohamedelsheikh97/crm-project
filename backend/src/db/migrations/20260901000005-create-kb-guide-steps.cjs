'use strict';

/**
 * The join between a guide and the articles that make it up (Phase 7).
 *
 * A JOIN, NOT A KIND OF ARTICLE (research D9). The article is unaware it is in
 * a guide, stays in its own category, and may appear in several guides — which
 * is FR-011b true by construction rather than by rule. Modelling a guide as a
 * special kind of article would have forced every article query in the system
 * to learn to exclude containers, and each of them would have had to remember.
 *
 * `position` is AUTHORED, not computed (spec Assumptions). There is no
 * prerequisite graph and no branching: somebody decides the order a reader
 * works through, and the system records it.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('kb_guide_steps', {
      guide_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        primaryKey: true,
        references: { model: 'kb_guides', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // An article appears at most once in a guide — the composite primary key
      // says so, rather than a service rule that could be forgotten.
      article_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        primaryKey: true,
        references: { model: 'kb_articles', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      position: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The read: every step of one guide, in order.
    await queryInterface.addIndex('kb_guide_steps', ['guide_id', 'position'], {
      name: 'kb_guide_steps_order',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('kb_guide_steps', 'kb_guide_steps_order');
    await queryInterface.dropTable('kb_guide_steps');
  },
};
