import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * The only way a portal account comes into existence (Phase 8, Clarifications
 * Q1, research.md D3).
 *
 * `token_hash` holds the SHA-256 of the emailed token. The token itself is
 * never stored, never logged, and never returned by an API — Phase 1's rule for
 * secrets applied to a secret that grants account creation.
 *
 * USABLE is all three at once, and `isUsable` below is the only place that
 * says so. Everything else — expired, spent, revoked, or a hash matching
 * nothing at all — is ONE identical refusal (FR-002c). Four causes, one answer,
 * because distinguishing them turns the endpoint into an oracle for which
 * invitations exist.
 *
 * Rows are RETAINED after acceptance or revocation: they are the audit trail of
 * who let whom in.
 */
export const INVITATION_PURPOSES = ['invitation', 'password_reset'] as const;

export type InvitationPurpose = (typeof INVITATION_PURPOSES)[number];

export class PortalInvitation extends Model<
  InferAttributes<PortalInvitation>,
  InferCreationAttributes<PortalInvitation>
> {
  declare id: CreationOptional<number>;
  declare customer_contact_id: number;
  declare token_hash: string;
  /**
   * An invitation and a password reset are the same object — a one-time,
   * expiring, revocable, hashed token emailed to a named contact and redeemed by
   * setting a password. This says which one, and the acceptance path reads it to
   * decide whether it is creating an account or replacing a password on one that
   * already exists.
   */
  declare purpose: CreationOptional<InvitationPurpose>;
  /** NULL only for a reset the customer requested themselves: no staff actor. */
  declare issued_by_user_id: number | null;
  declare expires_at: Date;
  /** Non-NULL = spent. Single-use is enforced here, not by deleting the row. */
  declare accepted_at: CreationOptional<Date | null>;
  declare revoked_at: CreationOptional<Date | null>;
  declare revoked_by_user_id: CreationOptional<number | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;

  /**
   * ONE DEFINITION, read by the acceptance path and by the staff screen that
   * reports "invited, not yet accepted". Two copies of this predicate would be
   * two chances for a spent invitation to look outstanding.
   */
  get isUsable(): NonAttribute<boolean> {
    return (
      this.accepted_at === null &&
      this.revoked_at === null &&
      this.expires_at.getTime() > Date.now()
    );
  }
}

PortalInvitation.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    customer_contact_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    purpose: {
      type: DataTypes.ENUM(...INVITATION_PURPOSES),
      allowNull: false,
      defaultValue: 'invitation',
    },
    issued_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    accepted_at: { type: DataTypes.DATE, allowNull: true },
    revoked_at: { type: DataTypes.DATE, allowNull: true },
    revoked_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'PortalInvitation', tableName: 'portal_invitations' },
);

export default PortalInvitation;
