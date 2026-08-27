import { sequelize } from '../config/database.js';

import { AuditLog } from './audit-log.model.js';
import { PasswordHistory } from './password-history.model.js';
import { RolePermission } from './role-permission.model.js';
import { Role } from './role.model.js';
import { User } from './user.model.js';

// Associations are declared in one place so the relationship wiring is
// reviewable at a glance rather than scattered across five files.
Role.hasMany(User, { foreignKey: 'role_id', as: 'users' });
User.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

Role.hasMany(RolePermission, { foreignKey: 'role_id', as: 'permissions' });
RolePermission.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

User.hasMany(PasswordHistory, { foreignKey: 'user_id', as: 'passwordHistory' });
PasswordHistory.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Nullable: an audit entry for a failed sign-in against an unknown identifier
// has no actor (FR-037). The entry must never lose its actor, which is why
// users are deactivated rather than deleted.
User.hasMany(AuditLog, { foreignKey: 'actor_user_id', as: 'auditEntries' });
AuditLog.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actor' });

export { sequelize, AuditLog, PasswordHistory, Role, RolePermission, User };
