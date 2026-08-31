'use strict';

/**
 * Administrator-defined web forms (Phase 5, FR-079-FR-085).
 *
 * FR-085 — "tickets created from an earlier version of a form must still read
 * correctly" — IS SOLVED WITHOUT A VERSION TABLE. A submission copies the
 * question text as it was asked into the resulting message body, so an old
 * ticket never refers to this table at all. Editing a definition therefore
 * cannot retroactively change what a customer appears to have been asked.
 *
 * A version table was considered and rejected: it makes every read of every old
 * ticket a join, to reconstruct text that could simply have been kept at the
 * moment it mattered. The copy is a few hundred bytes; the join would be
 * forever.
 *
 * `fields_json` holds the ordered questions — key, type, required, and a label
 * in each language. JSON rather than a `form_fields` table because nothing
 * queries across fields: a definition is always read whole, rendered whole, and
 * validated whole.
 *
 * `default_category` and `default_priority` are validated against Phase 3's
 * declared taxonomy in the service (FR-084). They are nullable strings here
 * rather than enums because that taxonomy is declared in TypeScript, and a
 * second copy in the schema is a second thing to keep in step.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('form_definitions', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // What the public address carries. Stable: changing it breaks every page
      // that embeds the form.
      slug: { type: Sequelize.STRING(64), allowNull: false },
      // Both languages required. A form asked in one language is a form half
      // the customers cannot answer (Principle I).
      title_en: { type: Sequelize.STRING(255), allowNull: false },
      title_ar: { type: Sequelize.STRING(255), allowNull: false },
      fields_json: { type: Sequelize.JSON, allowNull: false },
      default_category: { type: Sequelize.STRING(30), allowNull: true },
      default_priority: { type: Sequelize.STRING(20), allowNull: true },
      // Unpublished by default: a form becomes reachable by the public because
      // somebody published it.
      is_published: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('form_definitions', ['slug'], {
      name: 'form_definitions_slug',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('form_definitions', 'form_definitions_slug');
    await queryInterface.dropTable('form_definitions');
  },
};
