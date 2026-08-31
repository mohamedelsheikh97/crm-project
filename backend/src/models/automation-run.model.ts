import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * Four outcomes, and `no_match` is one of them on purpose (FR-067).
 *
 * A rule that did not match is RECORDED rather than discarded: User Story 4
 * requires a non-match to be visibly not an error, and "the rule never ran" and
 * "the rule ran and the conditions did not hold" are different diagnoses that
 * look identical from an empty table.
 */
export const RUN_OUTCOMES = ['acted', 'no_match', 'suppressed', 'failed'] as const;

export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** What one action did, so a partially failed rule stays legible (FR-065). */
export interface AppliedAction {
  action: string;
  result: 'ok' | 'failed';
  detail?: string;
  from?: unknown;
  to?: unknown;
}

/**
 * What automation actually did (Phase 6, FR-067-FR-070, User Story 7).
 *
 * THE RECORD OUTLIVES THE RULE (FR-070). `rule_id` goes null when a rule is
 * deleted; `rule_name` is denormalised beside it so the record still answers
 * "what changed this ticket overnight?" the morning after someone tidied up.
 *
 * `detail` HOLDS AN i18n KEY AND PARAMETERS, NEVER A SENTENCE — the same row
 * may be read by an Arabic user and an English one, so the language cannot be
 * decided at write time. Never a stack trace either.
 *
 * NO DESTROY PATH, following the audit log: bounded by paging, retained.
 */
export class AutomationRun extends Model<
  InferAttributes<AutomationRun>,
  InferCreationAttributes<AutomationRun>
> {
  declare id: CreationOptional<number>;
  declare rule_id: CreationOptional<number | null>;
  /** Denormalised deliberately — see the class comment. */
  declare rule_name: string;
  declare trigger_key: string;
  declare ticket_id: CreationOptional<number | null>;
  declare outcome: RunOutcome;
  /** JSON-encoded `{ key, params }`. Never a sentence. */
  declare detail: CreationOptional<string | null>;
  declare actions_applied: CreationOptional<AppliedAction[] | null>;
  /** Which cascade level. Makes a suppressed cycle readable. */
  declare depth: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AutomationRun.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    rule_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    rule_name: { type: DataTypes.STRING(120), allowNull: false },
    trigger_key: { type: DataTypes.STRING(60), allowNull: false },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    outcome: { type: DataTypes.STRING(20), allowNull: false },
    detail: { type: DataTypes.TEXT, allowNull: true },
    actions_applied: { type: DataTypes.JSON, allowNull: true },
    depth: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'AutomationRun',
    tableName: 'automation_runs',
  },
);

export default AutomationRun;
