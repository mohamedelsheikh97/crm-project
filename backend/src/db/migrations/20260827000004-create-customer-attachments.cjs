'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('customer_attachments', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'customers', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      uploaded_by_user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      // What the user called it. Display and Content-Disposition ONLY — it is
      // attacker-controlled input and must never become a path.
      original_name: { type: Sequelize.STRING(255), allowNull: false },
      // Generated. The only value that ever resolves to a location on disk.
      storage_key: { type: Sequelize.STRING(255), allowNull: false },
      // The SNIFFED type, not the client's claim (FR-032).
      content_type: { type: Sequelize.STRING(100), allowNull: false },
      size_bytes: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      // No updated_at: an attachment is written once.
      created_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('customer_attachments', ['storage_key'], {
      unique: true,
      name: 'customer_attachments_storage_key_unique',
    });
    await queryInterface.addIndex('customer_attachments', ['customer_id', 'created_at'], {
      name: 'customer_attachments_customer_created',
    });

    // NO scan-state column (Clarifications Q3). Files are not virus-scanned in
    // this phase, so no download path has to interpret one. Revisit before
    // Phase 8, whose customer portal would let files arrive from outside.
  },

  async down(queryInterface) {
    await queryInterface.dropTable('customer_attachments');
  },
};
