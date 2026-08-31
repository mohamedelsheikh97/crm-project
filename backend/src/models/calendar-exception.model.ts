import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * A dated non-working day (Phase 6, FR-027).
 *
 * `exception_date` is a LOCAL DATE in the calendar's zone, not an instant —
 * a public holiday is "the 21st", not "midnight UTC on the 21st". `DATEONLY`
 * arrives as a `YYYY-MM-DD` string, which is exactly what the day walk in
 * lib/business-hours.ts compares against, so nothing parses it into a Date and
 * back.
 */
export class CalendarException extends Model<
  InferAttributes<CalendarException>,
  InferCreationAttributes<CalendarException>
> {
  declare id: CreationOptional<number>;
  declare calendar_id: number;
  /** `YYYY-MM-DD` in the calendar's zone. */
  declare exception_date: string;
  declare label: CreationOptional<string | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

CalendarException.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    calendar_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    exception_date: { type: DataTypes.DATEONLY, allowNull: false },
    label: { type: DataTypes.STRING(120), allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'CalendarException',
    tableName: 'calendar_exceptions',
  },
);

export default CalendarException;
