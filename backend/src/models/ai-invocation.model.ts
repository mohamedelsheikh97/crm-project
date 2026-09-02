import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export type AiInvocationOutcome =
  'success' | 'failed' | 'refused_budget' | 'refused_disabled' | 'refused_ungrounded';

/**
 * One attempt to produce AI output (Phase 9, research.md D6).
 *
 * METADATA ONLY — see the migration for why. There is no `prompt` field and no
 * `completion` field, and `backend/tests/ai/invocation-columns.test.ts` freezes
 * the column list so neither can be added quietly.
 *
 * Written by `backend/src/ai/invoke.ts` on EVERY outcome, including the ones
 * where no provider was called at all: a disabled feature, an exhausted
 * ceiling, and the assistant declining below the grounding floor are all
 * recorded. That is what makes FR-063 answerable and SC-015's deflection rate
 * computable — the refusals are the interesting half.
 */
export class AiInvocation extends Model<
  InferAttributes<AiInvocation>,
  InferCreationAttributes<AiInvocation>
> {
  declare id: CreationOptional<number>;
  declare feature: string;
  declare subject_type: CreationOptional<'ticket' | 'conversation' | 'none'>;
  /** A REFERENCE, never content (FR-011). */
  declare subject_id: CreationOptional<number | null>;
  declare requested_by: CreationOptional<number | null>;
  declare portal_account_id: CreationOptional<number | null>;
  declare location: 'external' | 'local' | 'none';
  declare outcome: AiInvocationOutcome;
  declare input_tokens: CreationOptional<number | null>;
  declare output_tokens: CreationOptional<number | null>;
  declare duration_ms: CreationOptional<number | null>;
  /** A code, never a provider message — messages can echo submitted content. */
  declare error_code: CreationOptional<string | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AiInvocation.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    feature: { type: DataTypes.STRING(30), allowNull: false },
    subject_type: {
      type: DataTypes.ENUM('ticket', 'conversation', 'none'),
      allowNull: false,
      defaultValue: 'none',
    },
    subject_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    requested_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    portal_account_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    location: { type: DataTypes.ENUM('external', 'local', 'none'), allowNull: false },
    outcome: {
      type: DataTypes.ENUM(
        'success',
        'failed',
        'refused_budget',
        'refused_disabled',
        'refused_ungrounded',
      ),
      allowNull: false,
    },
    input_tokens: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    output_tokens: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    duration_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    error_code: { type: DataTypes.STRING(50), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'AiInvocation',
    tableName: 'ai_invocations',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
