import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * One article's place in one guide (Phase 7).
 *
 * A JOIN, NOT A KIND OF ARTICLE (research D9). The article is unaware it is in
 * a guide, stays in its own category, and may appear in several guides — FR-011b
 * true by construction rather than by rule.
 *
 * `position` is AUTHORED, not computed. There is no prerequisite graph and no
 * branching (spec Assumptions): somebody decides the order and the system
 * records it.
 */
export class KbGuideStep extends Model<
  InferAttributes<KbGuideStep>,
  InferCreationAttributes<KbGuideStep>
> {
  declare guide_id: number;
  declare article_id: number;
  declare position: number;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

KbGuideStep.init(
  {
    guide_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, allowNull: false },
    article_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, allowNull: false },
    position: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'KbGuideStep', tableName: 'kb_guide_steps' },
);

export default KbGuideStep;
