import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { TicketCategory } from '../tickets/taxonomy.js';

export type ProposalState = 'pending' | 'accepted' | 'dismissed';

/**
 * A proposed category, pending a human (Phase 9, Clarifications Q2).
 *
 * IT IS NEVER THE TICKET'S CATEGORY. It sits beside the field, and the only
 * thing that writes `tickets.category` is a person accepting — through the
 * Phase 3 update path, so their decision is recorded as theirs (FR-045a).
 *
 * NOTHING IN PHASE 6 READS THIS TABLE. Automation conditions and SLA policy
 * selection read `tickets.category` and know nothing of proposals. FR-045b is
 * therefore the ABSENCE OF A JOIN rather than a rule anyone has to remember,
 * and `backend/tests/ai/classify.test.ts` asserts it.
 */
export class AiCategoryProposal extends Model<
  InferAttributes<AiCategoryProposal>,
  InferCreationAttributes<AiCategoryProposal>
> {
  declare id: CreationOptional<number>;
  declare ticket_id: number;
  declare proposed: TicketCategory;
  declare confidence: CreationOptional<number | null>;
  declare state: CreationOptional<ProposalState>;
  declare resolved_by: CreationOptional<number | null>;
  declare resolved_at: CreationOptional<Date | null>;
  /** FR-049: what the category was when proposed, so a human's later choice wins. */
  declare category_at_proposal: string;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AiCategoryProposal.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
    proposed: { type: DataTypes.STRING(30), allowNull: false },
    confidence: {
      type: DataTypes.DECIMAL(4, 3),
      allowNull: true,
      // MySQL returns DECIMAL as a string; the interface and the reporting both
      // want a number, and converting at the boundary keeps that in one place.
      get(): number | null {
        const raw = this.getDataValue('confidence');
        return raw === null || raw === undefined ? null : Number(raw);
      },
    },
    state: {
      type: DataTypes.ENUM('pending', 'accepted', 'dismissed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    resolved_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    resolved_at: { type: DataTypes.DATE, allowNull: true },
    category_at_proposal: { type: DataTypes.STRING(30), allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'AiCategoryProposal',
    tableName: 'ai_category_proposals',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
