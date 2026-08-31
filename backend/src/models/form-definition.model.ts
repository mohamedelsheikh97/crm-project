import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export const FORM_FIELD_TYPES = ['text', 'textarea', 'email', 'phone'] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export interface FormFieldDefinition {
  key: string;
  type: FormFieldType;
  required: boolean;
  /** Both languages, always. A one-language question is unanswerable by half
   *  the customers (Principle I). */
  label_en: string;
  label_ar: string;
}

/**
 * An administrator-defined web form.
 *
 * FR-085 — "tickets created from an earlier version of a form must still read
 * correctly" — IS SOLVED WITHOUT A VERSION TABLE. A submission copies the
 * question text as it was asked into the resulting message body, so an old
 * ticket never refers to this record at all. Editing a definition therefore
 * cannot retroactively change what a customer appears to have been asked.
 *
 * A version table would make every read of every old ticket a join, to
 * reconstruct text that could simply have been kept at the moment it mattered.
 *
 * `fields_json` is JSON rather than a `form_fields` table because nothing
 * queries across fields: a definition is read whole, rendered whole, and
 * validated whole.
 */
export class FormDefinition extends Model<
  InferAttributes<FormDefinition>,
  InferCreationAttributes<FormDefinition>
> {
  declare id: CreationOptional<number>;
  /** What the public address carries. Changing it breaks every embedding page. */
  declare slug: string;
  declare title_en: string;
  declare title_ar: string;
  declare fields_json: FormFieldDefinition[];
  /** Validated against Phase 3's declared taxonomy in the service (FR-084). */
  declare default_category: CreationOptional<string | null>;
  declare default_priority: CreationOptional<string | null>;
  declare is_published: CreationOptional<boolean>;
  declare created_by_user_id: CreationOptional<number | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

FormDefinition.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    slug: { type: DataTypes.STRING(64), allowNull: false },
    title_en: { type: DataTypes.STRING(255), allowNull: false },
    title_ar: { type: DataTypes.STRING(255), allowNull: false },
    fields_json: { type: DataTypes.JSON, allowNull: false },
    default_category: { type: DataTypes.STRING(30), allowNull: true },
    default_priority: { type: DataTypes.STRING(20), allowNull: true },
    is_published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'FormDefinition', tableName: 'form_definitions' },
);

export default FormDefinition;
