'use strict';

/**
 * An article: one piece of what the organisation knows (Phase 7).
 *
 * Three columns here make a requirement STRUCTURALLY true rather than merely
 * checked, and each is worth more than the line it occupies:
 *
 *   status DEFAULT 'draft'      — FR-004. An article is visible because
 *                                 somebody published it, not because it was
 *                                 created. There is no path that creates a
 *                                 published article.
 *   audience DEFAULT 'internal' — the safe default for content nobody has
 *                                 considered is "colleagues only". Making it
 *                                 customer-visible is a decision (FR-031).
 *   category_id NOT NULL        — FR-010. An article that can only be found by
 *                                 search is one nobody can browse to, so filing
 *                                 is mandatory rather than encouraged.
 *
 * MEDIUMTEXT rather than TEXT for the bodies. A long procedure with examples
 * passes 64KB more easily than it looks, and hitting that ceiling truncates a
 * customer's instructions silently — the worst possible failure for content
 * whose whole purpose is to be complete.
 *
 * `slug` is derived from the title at FIRST PUBLISH and stable thereafter
 * (research D10). A slug that tracked the title would break every link already
 * sent the first time a typo was fixed.
 *
 * `view_count` is A COUNTER, NEVER AN EVENT TABLE (research D11). FR-050
 * forbids storing anything identifying a reader, and a counter cannot
 * accidentally grow an IP column the first time somebody wants a trend. Phase
 * 10 owns trends and can design its own thing.
 *
 * NO DESTROY PATH, and NO VERSION HISTORY. FR-007 makes archiving the removal;
 * an edit replaces the text and the audit log records who did it. The second is
 * a stated limitation (spec Assumptions) rather than an oversight — adding
 * history later is a new table, not a change to this one.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('kb_articles', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // RESTRICT, not CASCADE or SET NULL: deleting a category that still holds
      // articles must fail loudly (FR-015), and the service turns that into a
      // refusal naming the count.
      category_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'kb_categories', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // Empty until first publish; unique once set. Nullable because a draft
      // has no public URL and inventing one before anybody decides to publish
      // would reserve a name for a document that may never exist.
      slug: { type: Sequelize.STRING(180), allowNull: true, unique: true },
      // Phase 4's `reply_templates` shape, reused deliberately (research D8):
      // one logical item, optionally present in two languages. At least one
      // COMPLETE pair is required to publish (FR-005).
      title_en: { type: Sequelize.STRING(200), allowNull: true },
      title_ar: { type: Sequelize.STRING(200), allowNull: true },
      body_en: { type: Sequelize.TEXT('medium'), allowNull: true },
      body_ar: { type: Sequelize.TEXT('medium'), allowNull: true },
      status: {
        type: Sequelize.ENUM('draft', 'published', 'archived'),
        allowNull: false,
        defaultValue: 'draft',
      },
      audience: {
        type: Sequelize.ENUM('internal', 'customer'),
        allowNull: false,
        defaultValue: 'internal',
      },
      // FR-006. Null until first publish, and NOT cleared by archiving: "when
      // did this first go live" stays true across an archive and a restore.
      published_at: { type: Sequelize.DATE, allowNull: true },
      published_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      // FR-048 — "when was this last touched, and by whom" is the whole of the
      // stewardship view.
      updated_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      view_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The visibility predicate every reader query starts from.
    await queryInterface.addIndex('kb_articles', ['status', 'audience'], {
      name: 'kb_articles_visibility',
    });
    // Browsing a category, which always filters by status.
    await queryInterface.addIndex('kb_articles', ['category_id', 'status'], {
      name: 'kb_articles_category',
    });
    // The stewardship view sorts by this (FR-051).
    await queryInterface.addIndex('kb_articles', ['updated_at'], {
      name: 'kb_articles_updated',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('kb_articles', 'kb_articles_updated');
    await queryInterface.removeIndex('kb_articles', 'kb_articles_category');
    await queryInterface.removeIndex('kb_articles', 'kb_articles_visibility');
    await queryInterface.dropTable('kb_articles');
  },
};
