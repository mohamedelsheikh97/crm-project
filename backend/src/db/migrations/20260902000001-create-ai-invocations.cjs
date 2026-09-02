'use strict';

/**
 * One row per attempt to produce AI output (Phase 9, research.md D6, D11).
 *
 * METADATA ONLY. There is no column for the submitted content and none for the
 * generated text, and that absence is the whole of Clarifications Q3. A
 * prompt-and-response log would be a SECOND COPY of every ticket thread in the
 * system, in plaintext, with its own lifetime, its own access rules, and its own
 * deletion obligation — sitting outside every protection Phases 2, 5 and 8 built
 * around the first copy.
 *
 * The cost of that decision is real and worth stating: when an agent reports
 * that a summary was wrong, THERE IS NO RECORD OF WHAT THE MODEL WAS SHOWN. It
 * is accepted because a summary can be regenerated from a thread that has not
 * gone anywhere, and because the alternative is the paragraph above.
 *
 * `backend/tests/ai/invocation-columns.test.ts` freezes this column list, so
 * adding a `prompt` column "temporarily for debugging" fails a test rather than
 * passing review.
 *
 * `subject_id` IS A REFERENCE, NEVER CONTENT (FR-011). It answers "which ticket
 * was this about" by pointing at the ticket.
 *
 * BIGINT, unlike most tables here: this is written once per view rather than
 * once per business event, and summary panels are opened all day.
 *
 * `refused_ungrounded` records the assistant declining WITHOUT calling a model
 * (research D3 step 2) — an invocation record for a call that never happened,
 * on purpose. SC-015's deflection rate is computed from it, and it is also the
 * cheapest possible implementation of FR-034.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ai_invocations', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // One of backend/src/ai/features.ts. A string rather than an ENUM so a
      // later phase adding a sixth feature does not need a schema migration to
      // record it.
      feature: { type: Sequelize.STRING(30), allowNull: false },
      subject_type: {
        type: Sequelize.ENUM('ticket', 'conversation', 'none'),
        allowNull: false,
        defaultValue: 'none',
      },
      subject_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      // Exactly one of these two, or neither for system-initiated
      // classification. NEVER BOTH — they are different identity realms, and
      // Phase 8 exists because conflating them is dangerous.
      requested_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      portal_account_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'portal_accounts', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      // What SC-024a asserts against: no `assistant` row may ever carry
      // `external`.
      location: { type: Sequelize.ENUM('external', 'local', 'none'), allowNull: false },
      outcome: {
        type: Sequelize.ENUM(
          'success',
          'failed',
          'refused_budget',
          'refused_disabled',
          'refused_ungrounded',
        ),
        allowNull: false,
      },
      input_tokens: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      output_tokens: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      duration_ms: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      // A CODE, never a provider message: a provider message can echo the
      // submitted content back, which is the one thing this table must not hold.
      error_code: { type: Sequelize.STRING(50), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // The ceiling count reads (feature, created_at) on every invocation, so it
    // is the index that has to exist (research D11).
    await queryInterface.addIndex('ai_invocations', ['feature', 'created_at'], {
      name: 'ai_invocations_feature_created_idx',
    });

    await queryInterface.addIndex('ai_invocations', ['subject_type', 'subject_id'], {
      name: 'ai_invocations_subject_idx',
    });

    await queryInterface.addIndex('ai_invocations', ['created_at'], {
      name: 'ai_invocations_created_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_invocations');
  },
};
