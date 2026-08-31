import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * What a working hour is (Phase 6, Clarifications Q1, FR-025a, FR-026).
 *
 * Hours are MINUTES FROM LOCAL MIDNIGHT and days are a 7-BIT MASK with Sunday
 * as bit 0 — see the migration for why. The wire shape is an array of weekday
 * numbers; the conversion happens at the API boundary so neither the arithmetic
 * nor the checkbox group is compromised.
 */
export class BusinessCalendar extends Model<
  InferAttributes<BusinessCalendar>,
  InferCreationAttributes<BusinessCalendar>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  /** An IANA zone name, validated at the API boundary, never inside a sweep. */
  declare time_zone: CreationOptional<string>;
  /** Bit 0 = Sunday. 31 = Sun-Thu; 62 would be Mon-Fri. */
  declare working_days: CreationOptional<number>;
  declare day_start_minute: CreationOptional<number>;
  declare day_end_minute: CreationOptional<number>;
  declare is_active: CreationOptional<boolean>;
  declare updated_by_user_id: CreationOptional<number | null>;
  declare version: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

BusinessCalendar.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    time_zone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'Africa/Cairo' },
    working_days: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 31 },
    day_start_minute: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 540 },
    day_end_minute: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1020 },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    updated_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'BusinessCalendar',
    tableName: 'business_calendars',
    version: true,
  },
);

export default BusinessCalendar;
