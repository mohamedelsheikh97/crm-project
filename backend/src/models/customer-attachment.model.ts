import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * Metadata only — the binary lives on the filesystem (research.md D2).
 *
 * `original_name` and `storage_key` are separate columns on purpose.
 * `original_name` is attacker-controlled input, and a filename containing
 * `../..` is how it becomes a path traversal. The generated `storage_key` is
 * the only value that ever touches the filesystem, and it is never returned in
 * an API response.
 *
 * NO scan-state column (Clarifications Q3).
 */
export class CustomerAttachment extends Model<
  InferAttributes<CustomerAttachment>,
  InferCreationAttributes<CustomerAttachment>
> {
  declare id: CreationOptional<number>;
  declare customer_id: number;
  declare uploaded_by_user_id: number;
  declare original_name: string;
  declare storage_key: string;
  declare content_type: string;
  declare size_bytes: number;
  declare readonly created_at: CreationOptional<Date>;
}

CustomerAttachment.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    uploaded_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    original_name: { type: DataTypes.STRING(255), allowNull: false },
    storage_key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    content_type: { type: DataTypes.STRING(100), allowNull: false },
    size_bytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    created_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'CustomerAttachment',
    tableName: 'customer_attachments',
    // An attachment is written once.
    timestamps: true,
    updatedAt: false,
  },
);

export default CustomerAttachment;
