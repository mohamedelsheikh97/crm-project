import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * The correspondence between a customer here and its ERP counterpart
 * (Phase 11, FR-041 - FR-043, research D12).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `last_synced_values` PROTECTS AN AGENT'S WORK, AND IT IS WHY THIS IS A TABLE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FR-043 forbids a sync silently overwriting a value a person edited here, which
 * requires answering "did a human change this field since we last wrote it?".
 * Storing what the sync last wrote answers it exactly: current equals
 * last-written means nobody touched it; current differs means somebody did.
 *
 * The two obvious alternatives are worse. `customers.updated_at` against
 * `last_reconciled_at` is too coarse to be per-field — any change marks every
 * field as touched. Reading the audit log per field makes correctness depend on
 * audit RETENTION, so pruning the log would start silently overwriting agents'
 * work.
 *
 * It is sync bookkeeping rather than a property of the customer, which is the
 * first of three reasons this is not a `customers.erp_external_id` column. The
 * others: a second adapter later needs two links for one customer, and Phase 2
 * owns `customers` — integration bookkeeping there would appear in a table five
 * other phases read.
 */
export class ErpLink extends Model<InferAttributes<ErpLink>, InferCreationAttributes<ErpLink>> {
  declare id: CreationOptional<number>;
  declare customer_id: number;
  /** The ERP's identifier. Stable forever — this is the link. */
  declare external_id: string;
  declare adapter_key: string;
  declare last_reconciled_at: CreationOptional<Date | null>;
  /** The values the sync last wrote. The human-edit detector. */
  declare last_synced_values: Record<string, unknown>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ErpLink.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
    external_id: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    adapter_key: { type: DataTypes.STRING(40), allowNull: false },
    last_reconciled_at: { type: DataTypes.DATE, allowNull: true },
    last_synced_values: { type: DataTypes.JSON, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'ErpLink',
    tableName: 'erp_links',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
