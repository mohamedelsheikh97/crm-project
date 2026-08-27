import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { ContactKind } from '../lib/phone.js';

/**
 * A phone number or email belonging to a customer.
 *
 * Rows rather than columns on `customers`, because the duplicate check is this
 * phase's core requirement and needs a single indexed lookup regardless of how
 * many contacts anyone holds (research.md D7).
 *
 * `value_raw` is NEVER rewritten — it is what the user typed and what a human
 * is shown. `value_normalised` is set explicitly by the service using
 * lib/phone.ts, which is the single normalisation site.
 */
export class CustomerContact extends Model<
  InferAttributes<CustomerContact>,
  InferCreationAttributes<CustomerContact>
> {
  declare id: CreationOptional<number>;
  declare customer_id: number;
  declare kind: ContactKind;
  declare value_raw: string;
  declare value_normalised: string;
  declare is_primary: CreationOptional<boolean>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

CustomerContact.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    kind: { type: DataTypes.ENUM('phone', 'email'), allowNull: false },
    // No setter: trimming is fine, rewriting is not.
    value_raw: {
      type: DataTypes.STRING(255),
      allowNull: false,
      set(value: string) {
        this.setDataValue('value_raw', String(value).trim());
      },
    },
    value_normalised: { type: DataTypes.STRING(255), allowNull: false },
    is_primary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'CustomerContact', tableName: 'customer_contacts' },
);

export default CustomerContact;
