import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export const SYNC_MODES = ['preview', 'apply'] as const;
export const SYNC_STATES = ['running', 'completed', 'failed', 'abandoned'] as const;

export type SyncMode = (typeof SYNC_MODES)[number];
export type SyncState = (typeof SYNC_STATES)[number];

/**
 * One synchronisation (Phase 11, FR-044 - FR-049, research D13).
 *
 * `mode` PUTS PREVIEW AND APPLY ON ONE TABLE. SC-017 requires a preview to
 * report the same set the run applies, and that is checkable by comparing two
 * rows of the same shape rather than two different structures. It also means the
 * preview's per-record classification is stored, so "the preview said X and the
 * run did Y" is answerable after the fact rather than from memory.
 *
 * `cursor` IS AN OPTIMISATION, NOT A CORRECTNESS REQUIREMENT, and that is the
 * right way round. Every record is applied idempotently — upsert keyed on the
 * external identifier — so a retry is correct regardless of where it starts. A
 * position that merely saves work cannot corrupt anything by being slightly
 * wrong.
 *
 * ONE `running` ROW PER ADAPTER is enforced by a generated column plus a unique
 * index in the migration, not by a check here (FR-048). An application check has
 * a window between the read and the write, and the failure it allows is two
 * syncs interleaving writes to the same customers.
 *
 * `running_adapter_key` is that generated column. It is declared here so
 * Sequelize does not attempt to write it — the database computes it.
 */
export class ErpSyncRun extends Model<
  InferAttributes<ErpSyncRun>,
  InferCreationAttributes<ErpSyncRun>
> {
  declare id: CreationOptional<number>;
  declare adapter_key: string;
  declare mode: SyncMode;
  declare state: CreationOptional<SyncState>;
  declare cursor: CreationOptional<string | null>;
  declare created_count: CreationOptional<number>;
  declare updated_count: CreationOptional<number>;
  declare skipped_count: CreationOptional<number>;
  /** Where a human edit was involved (FR-043) — distinct from a skip. */
  declare conflict_count: CreationOptional<number>;
  declare started_by_user_id: CreationOptional<number | null>;
  declare started_at: CreationOptional<Date | null>;
  declare finished_at: CreationOptional<Date | null>;
  declare failure_reason: CreationOptional<string | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ErpSyncRun.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    adapter_key: { type: DataTypes.STRING(40), allowNull: false },
    mode: { type: DataTypes.ENUM(...SYNC_MODES), allowNull: false },
    state: { type: DataTypes.ENUM(...SYNC_STATES), allowNull: false, defaultValue: 'running' },
    cursor: { type: DataTypes.STRING(255), allowNull: true },
    created_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    updated_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    skipped_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    conflict_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    started_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    started_at: { type: DataTypes.DATE, allowNull: true },
    finished_at: { type: DataTypes.DATE, allowNull: true },
    failure_reason: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'ErpSyncRun',
    tableName: 'erp_sync_runs',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
