import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
} from 'sequelize';

import { sequelize } from '../config/database.js';

export const PORTAL_ACCOUNT_STATUSES = ['active', 'withdrawn'] as const;

export type PortalAccountStatus = (typeof PORTAL_ACCOUNT_STATUSES)[number];

/**
 * A customer's means of signing in to the portal (Phase 8, research.md D2).
 *
 * KEYED TO A CONTACT, NOT A CUSTOMER. Clarifications Q2 scopes the portal to
 * the signing-in contact, so a company record with three email contacts has up
 * to three independent accounts, each seeing only its own requests. The unique
 * index on `customer_contact_id` makes that a schema fact.
 *
 * THIS IS NOT A `users` ROW. A customer in `users` would appear in assignment
 * pickers and user lists, need a `role_id`, and count toward Phase 1's
 * last-administrator invariant. There is no `role_id` here and no customer
 * entry in the permission catalog: portal capability comes from holding a
 * portal session, not from a grant.
 *
 * NO `customer_id`. The customer is the contact's customer, derived by join —
 * the reasoning `timeline.service.ts` gives for messages: a denormalised copy
 * is a second place for the truth to live, which Phase 2's customer merge would
 * have to keep in step, and a stale one would point this account at the wrong
 * company.
 *
 * NO DESTROY PATH of its own. Withdrawal is the removal, and the row goes only
 * when the contact it belongs to does (FR-003b).
 */
export class PortalAccount extends Model<
  InferAttributes<PortalAccount>,
  InferCreationAttributes<PortalAccount>
> {
  declare id: CreationOptional<number>;
  declare customer_contact_id: number;
  declare password_hash: string;
  declare status: CreationOptional<PortalAccountStatus>;
  declare failed_login_attempts: CreationOptional<number>;
  declare locked_until: CreationOptional<Date | null>;
  /**
   * Bumped to invalidate every refresh token already issued.
   *
   * An access token is refused within its 15 minutes by the middleware's
   * per-request freshness read; a refresh token lives seven days and carries
   * this value as a claim, so withdrawal, credential reset, and "sign out
   * everywhere" all take effect immediately rather than at expiry (FR-060).
   */
  declare session_epoch: CreationOptional<number>;
  declare invited_by_user_id: CreationOptional<number | null>;
  declare activated_at: Date;
  declare last_login_at: CreationOptional<Date | null>;
  /** NULL means "not chosen yet", which is not the same as English (FR-064). */
  declare preferred_language: CreationOptional<'ar' | 'en' | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;

  /**
   * Derived, not stored — lockout is "is `locked_until` in the future", the
   * same shape Phase 1 gave `User`. A stored boolean would need a sweep to
   * clear it, and a sweep that fails leaves somebody locked out forever.
   */
  get isLockedOut(): NonAttribute<boolean> {
    return this.locked_until !== null && this.locked_until.getTime() > Date.now();
  }
}

PortalAccount.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    customer_contact_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    status: {
      type: DataTypes.ENUM(...PORTAL_ACCOUNT_STATUSES),
      allowNull: false,
      defaultValue: 'active',
    },
    failed_login_attempts: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    locked_until: { type: DataTypes.DATE, allowNull: true },
    session_epoch: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    invited_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    activated_at: { type: DataTypes.DATE, allowNull: false },
    last_login_at: { type: DataTypes.DATE, allowNull: true },
    preferred_language: { type: DataTypes.ENUM('ar', 'en'), allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'PortalAccount', tableName: 'portal_accounts' },
);

export default PortalAccount;
