import { sequelize } from '../config/database.js';

import { AuditLog } from './audit-log.model.js';
import { CustomerAttachment } from './customer-attachment.model.js';
import { CustomerContact } from './customer-contact.model.js';
import { CustomerNote } from './customer-note.model.js';
import { Customer } from './customer.model.js';
import { DuplicateOverride } from './duplicate-override.model.js';
import { PasswordHistory } from './password-history.model.js';
import { RolePermission } from './role-permission.model.js';
import { Role } from './role.model.js';
import { User } from './user.model.js';

// Associations are declared in one place so the relationship wiring is
// reviewable at a glance rather than scattered across ten files.

// --- Phase 1: users, roles, permissions, audit ---
Role.hasMany(User, { foreignKey: 'role_id', as: 'users' });
User.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

Role.hasMany(RolePermission, { foreignKey: 'role_id', as: 'permissions' });
RolePermission.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

User.hasMany(PasswordHistory, { foreignKey: 'user_id', as: 'passwordHistory' });
PasswordHistory.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Nullable: a failed sign-in against an unknown identifier has no actor.
User.hasMany(AuditLog, { foreignKey: 'actor_user_id', as: 'auditEntries' });
AuditLog.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actor' });

// --- Phase 2: customers ---
// Customers are never deleted (Clarifications Q1), so every cascade below
// exists for schema correctness rather than as an expected path — the same
// posture Phase 1 took with users.
Customer.hasMany(CustomerContact, { foreignKey: 'customer_id', as: 'contacts' });
CustomerContact.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

Customer.hasMany(CustomerNote, { foreignKey: 'customer_id', as: 'notes' });
CustomerNote.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
CustomerNote.belongsTo(User, { foreignKey: 'author_user_id', as: 'author' });

Customer.hasMany(CustomerAttachment, { foreignKey: 'customer_id', as: 'attachments' });
CustomerAttachment.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
CustomerAttachment.belongsTo(User, { foreignKey: 'uploaded_by_user_id', as: 'uploader' });

Customer.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });

// A customer appears on both sides of an override: as the record being saved
// and as the record the user was warned about.
DuplicateOverride.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
DuplicateOverride.belongsTo(Customer, {
  foreignKey: 'matched_customer_id',
  as: 'matchedCustomer',
});
DuplicateOverride.belongsTo(User, { foreignKey: 'decided_by_user_id', as: 'decidedBy' });

export {
  sequelize,
  AuditLog,
  Customer,
  CustomerAttachment,
  CustomerContact,
  CustomerNote,
  DuplicateOverride,
  PasswordHistory,
  Role,
  RolePermission,
  User,
};
