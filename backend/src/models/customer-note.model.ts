import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * A dated, attributed note on a customer.
 *
 * `edited_at` is deliberately separate from `updated_at`: the latter moves for
 * any write, while the former means specifically "a human changed what this
 * says", which is what the interface must surface (FR-026). A silently
 * rewritten note is worse than no note.
 *
 * NO visibility column (Clarifications Q2) — every note is visible to anyone
 * who may view the customer.
 */
export class CustomerNote extends Model<
  InferAttributes<CustomerNote>,
  InferCreationAttributes<CustomerNote>
> {
  declare id: CreationOptional<number>;
  declare customer_id: number;
  declare author_user_id: number;
  declare body: string;
  declare edited_at: Date | null;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

CustomerNote.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    author_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    edited_at: { type: DataTypes.DATE, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'CustomerNote', tableName: 'customer_notes' },
);

export default CustomerNote;
