import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { TicketCategory } from '../tickets/taxonomy.js';

/**
 * Which categories a user is competent in (Phase 6, Clarifications Q3,
 * FR-044a, FR-044c).
 *
 * A FLAT SET. No level, no weight, no team — those are Phase 12's business and
 * must not be anticipated here. The composite primary key IS the set, so a
 * duplicate is impossible rather than deduplicated.
 */
export class UserCompetency extends Model<
  InferAttributes<UserCompetency>,
  InferCreationAttributes<UserCompetency>
> {
  declare user_id: number;
  declare category: TicketCategory;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

UserCompetency.init(
  {
    user_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    category: { type: DataTypes.STRING(30), primaryKey: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'UserCompetency',
    tableName: 'user_competencies',
  },
);

export default UserCompetency;
