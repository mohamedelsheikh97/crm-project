import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export const SYNC_OUTCOMES = ['created', 'updated', 'skipped', 'conflict', 'failed'] as const;

export type SyncOutcome = (typeof SYNC_OUTCOMES)[number];

/** A field the sync changed, with what it replaced. */
export interface ChangedField {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
  /** True where the replaced value was a person's edit (FR-043). */
  readonly wasHumanEdit: boolean;
}

/**
 * What one run did to one record, and why (Phase 11, FR-046, FR-049).
 *
 * `reason` IS MANDATORY FOR EVERY NON-TRIVIAL OUTCOME. The natural
 * implementation logs "skipped: 47" and leaves the reader to guess; a skip
 * without a reason is a record an administrator cannot act on, which is exactly
 * why FR-046 exists as a requirement rather than a nicety.
 *
 * `changed_fields` RECORDS BEFORE AND AFTER, which is what makes FR-043's
 * "recorded and visible" true for the conflict case — the value that lost is
 * still readable weeks later. `wasHumanEdit` marks which of them were somebody's
 * work, so the conflict list is not just a diff.
 *
 * `outcome: 'conflict'` is distinct from `'skipped'`: a conflict is a decision
 * the declared field-ownership rule made, not a record the sync could not use.
 * Collapsing them would hide the cases somebody should review.
 */
export class ErpSyncRecord extends Model<
  InferAttributes<ErpSyncRecord>,
  InferCreationAttributes<ErpSyncRecord>
> {
  declare id: CreationOptional<number>;
  declare sync_run_id: number;
  declare external_id: string;
  /** NULL where creation was skipped — there is no customer to point at. */
  declare customer_id: CreationOptional<number | null>;
  declare outcome: SyncOutcome;
  declare reason: CreationOptional<string | null>;
  declare changed_fields: CreationOptional<ChangedField[] | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ErpSyncRecord.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    sync_run_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    external_id: { type: DataTypes.STRING(120), allowNull: false },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    outcome: { type: DataTypes.ENUM(...SYNC_OUTCOMES), allowNull: false },
    reason: { type: DataTypes.STRING(255), allowNull: true },
    changed_fields: { type: DataTypes.JSON, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'ErpSyncRecord',
    tableName: 'erp_sync_records',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
