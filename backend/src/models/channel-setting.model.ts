import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { Channel } from './message.model.js';

/**
 * Whether a channel is switched on, and its non-secret settings.
 *
 * THERE IS NO CREDENTIAL FIELD, AND NONE IS TO BE ADDED. FR-006 puts secrets in
 * environment configuration, unreadable through any interface, which is how
 * every other secret in this project is handled. A row an administrator edits
 * through a screen is the wrong home for an access token: it turns a database
 * read into a credential leak and puts the secret somewhere a backup, a log, or
 * an export can carry it.
 *
 * The PROVIDER is not here either — it lives in the environment because it
 * selects which code runs, and selecting code from an editable row is a larger
 * blast radius than this phase needs.
 *
 * Disabled by default: a channel starts carrying real customer conversations
 * because somebody turned it on, not because a migration ran.
 */
export class ChannelSetting extends Model<
  InferAttributes<ChannelSetting>,
  InferCreationAttributes<ChannelSetting>
> {
  declare id: CreationOptional<number>;
  declare channel: Channel;
  declare is_enabled: CreationOptional<boolean>;
  /** Non-secret knobs only. The service refuses anything credential-shaped. */
  declare settings_json: CreationOptional<Record<string, unknown> | null>;
  declare updated_by_user_id: CreationOptional<number | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

ChannelSetting.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    channel: { type: DataTypes.STRING(20), allowNull: false },
    is_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    settings_json: { type: DataTypes.JSON, allowNull: true },
    updated_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'ChannelSetting', tableName: 'channel_settings' },
);

export default ChannelSetting;
