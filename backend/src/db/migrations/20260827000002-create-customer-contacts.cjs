'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('customer_contacts', {
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
      kind: { type: Sequelize.ENUM('phone', 'email'), allowNull: false },
      // Exactly what the user typed. Always what a human is shown.
      value_raw: { type: Sequelize.STRING(255), allowNull: false },
      // E.164 or digits-only for a phone, lowercased for an email. Used for
      // matching and search only — NEVER displayed.
      value_normalised: { type: Sequelize.STRING(255), allowNull: false },
      is_primary: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The index that matters: every duplicate check and every contact search is
    // a lookup against this column.
    await queryInterface.addIndex('customer_contacts', ['value_normalised'], {
      name: 'customer_contacts_value_normalised',
    });
    await queryInterface.addIndex('customer_contacts', ['customer_id'], {
      name: 'customer_contacts_customer_id',
    });
    await queryInterface.addIndex('customer_contacts', ['customer_id', 'kind'], {
      name: 'customer_contacts_customer_kind',
    });

    // DELIBERATELY NOT UNIQUE. FR-023 requires a shared number to be enterable
    // after an explicit decision — a household phone belonging to two people is
    // ordinary. Uniqueness here would turn a question into a refusal.
  },

  async down(queryInterface) {
    await queryInterface.dropTable('customer_contacts');
  },
};
