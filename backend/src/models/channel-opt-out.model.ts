import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { Channel } from './message.model.js';

export type OptOutSource = 'keyword' | 'provider' | 'agent';

/**
 * A refusal to be messaged again on one channel.
 *
 * KEYED BY IDENTITY, DELIBERATELY NOT BY CUSTOMER. A person who replies STOP
 * has refused messages to THAT NUMBER, and the refusal has to survive things
 * the customer record does not: the number moving between customers, a merge,
 * a split, a deactivation, or a provisional customer being merged away.
 *
 * Keying on `customer_id` would let any of those quietly resurrect consent, and
 * nobody would notice until somebody who asked to be left alone was messaged
 * again. Keying on the normalised identity means the refusal outlives every
 * customer-record change, because it was never about the record.
 */
export class ChannelOptOut extends Model<
  InferAttributes<ChannelOptOut>,
  InferCreationAttributes<ChannelOptOut>
> {
  declare id: CreationOptional<number>;
  declare channel: Channel;
  /** Through lib/phone.ts: formatting must not be able to defeat a refusal. */
  declare identity_normalised: string;
  declare opted_out_at: Date;
  declare source: OptOutSource;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ChannelOptOut.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    channel: { type: DataTypes.STRING(20), allowNull: false },
    identity_normalised: { type: DataTypes.STRING(255), allowNull: false },
    opted_out_at: { type: DataTypes.DATE, allowNull: false },
    source: { type: DataTypes.STRING(20), allowNull: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'ChannelOptOut', tableName: 'channel_opt_outs' },
);

export default ChannelOptOut;
