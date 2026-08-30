'use strict';

/**
 * The quick-reply template library (Phase 4, research.md D8, Clarifications Q2).
 *
 * In this phase a template is inserted into the INTERNAL NOTE COMPOSER or
 * copied to the clipboard. Nothing is sent to a customer, because no
 * customer-facing correspondence exists until Phase 5. Building a send button
 * with nowhere to send would have pulled Phase 5's core scope forward; Phase 5
 * instead adds channels as new insertion targets and rebuilds none of this.
 *
 * Per-language columns rather than a rows-per-language table: a template has at
 * most two versions and always the same two, so a join buys nothing and costs a
 * query on every picker keystroke.
 *
 * Both language pairs are nullable but AT LEAST ONE COMPLETE PAIR is required.
 * That is enforced by zod at the controller boundary rather than here, because
 * "title_en AND body_en, OR title_ar AND body_ar" is clearer as a validator
 * than as a CHECK — and the validator can say which half is missing.
 *
 * RETIREMENT, NOT DELETION (FR-071), consistent with everything else in this
 * project: customers deactivate, tickets merge, nothing is destroyed. A retired
 * template leaves the picker and changes nothing already written from it.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('reply_templates', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      title_en: { type: Sequelize.STRING(160), allowNull: true },
      title_ar: { type: Sequelize.STRING(160), allowNull: true },
      body_en: { type: Sequelize.TEXT, allowNull: true },
      body_ar: { type: Sequelize.TEXT, allowNull: true },
      // NULL = offered in the picker.
      retired_at: { type: Sequelize.DATE, allowNull: true },
      created_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('reply_templates', ['retired_at'], {
      name: 'reply_templates_retired',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('reply_templates');
  },
};
