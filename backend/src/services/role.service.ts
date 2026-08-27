import { sequelize } from '../config/database.js';
import { allPermissionKeys, isPermissionKey, type PermissionKey } from '../auth/permissions.js';
import {
  conflict,
  forbidden,
  notFound,
  staleRecord,
  validationError,
} from '../errors/app-error.js';
import { Role, RolePermission, User } from '../models/index.js';

import * as auditService from './audit.service.js';
import * as authorizationService from './authorization.service.js';
import type { Actor, AuditContext } from './user.service.js';

/**
 * Capabilities that must remain reachable by SOME role at all times, or the
 * system is locked out of its own administration (FR-018).
 */
const PROTECTED_CAPABILITIES: PermissionKey[] = ['users:update', 'roles:update_permissions'];

export interface RoleView {
  id: number;
  key: string;
  nameKey: string;
  descriptionKey: string;
  permissions: string[];
  userCount: number;
  version: number;
}

/**
 * Not paged: there are three rows and always will be (FR-021).
 *
 * `version` is derived from the grant set rather than a stored column. Roles
 * themselves are immutable; what changes is which permissions they hold, so the
 * thing a concurrent edit can clash over is the grants.
 */
export async function list(): Promise<{ items: RoleView[] }> {
  const roles = await Role.findAll({ order: [['id', 'ASC']] });
  const items: RoleView[] = [];

  for (const role of roles) {
    const granted = await authorizationService.getRolePermissions(role.id);
    const userCount = await User.count({ where: { role_id: role.id } });

    items.push({
      id: role.id,
      key: role.key,
      nameKey: role.name_key,
      descriptionKey: role.description_key,
      permissions: [...granted].sort(),
      userCount,
      version: await grantVersion(role.id),
    });
  }

  return { items };
}

/**
 * A cheap optimistic-locking token for a set that has no version column: the
 * count of rows plus the most recent write. Two Administrators editing the same
 * role will disagree on it, which is exactly what FR-011's edge case needs.
 */
async function grantVersion(roleId: number): Promise<number> {
  const rows = await RolePermission.findAll({
    where: { role_id: roleId },
    attributes: ['id', 'updated_at'],
  });

  const latest = rows.reduce((max, row) => Math.max(max, row.updated_at.getTime()), 0);

  return rows.length * 1_000_000 + (latest % 1_000_000);
}

export async function replacePermissions(
  roleId: number,
  keys: unknown,
  version: unknown,
  actor: Actor,
  context: AuditContext = {},
): Promise<RoleView> {
  const role = await Role.findByPk(roleId);

  if (!role) {
    throw notFound();
  }

  if (!Array.isArray(keys)) {
    throw validationError([{ field: 'permissions', message: 'role.error.permissionsRequired' }]);
  }

  const unknownKeys = keys.filter((key) => !isPermissionKey(key));

  if (unknownKeys.length > 0) {
    throw validationError(
      unknownKeys.map(() => ({ field: 'permissions', message: 'role.error.unknownPermission' })),
    );
  }

  if ((await grantVersion(roleId)) !== Number(version)) {
    throw staleRecord();
  }

  const requested = new Set(keys as PermissionKey[]);
  const previous = [...(await authorizationService.getRolePermissions(roleId))].sort();

  // Refuse a change that strips the acting administrator's own access — they
  // would then be unable to undo it (FR-008).
  if (actor.id > 0) {
    const acting = await User.findByPk(actor.id);

    if (acting && acting.role_id === roleId) {
      for (const capability of PROTECTED_CAPABILITIES) {
        if (previous.includes(capability) && !requested.has(capability)) {
          throw forbidden();
        }
      }
    }
  }

  // Checked against the RESULTING state of ALL roles, not just this one — the
  // question is whether any role would still hold the capability afterwards.
  for (const capability of PROTECTED_CAPABILITIES) {
    const holders = await authorizationService.rolesGranting(capability);
    const others = holders.filter((id) => id !== roleId);

    if (others.length === 0 && !requested.has(capability)) {
      throw conflict('This change would leave the system with no way to administer it.');
    }
  }

  await sequelize.transaction(async (transaction) => {
    await RolePermission.destroy({ where: { role_id: roleId }, transaction });

    if (requested.size > 0) {
      await RolePermission.bulkCreate(
        [...requested].map((permission_key) => ({ role_id: roleId, permission_key })),
        { transaction },
      );
    }

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'role',
        targetId: role.id,
        targetLabel: role.key,
        previousValue: { permissions: previous },
        newValue: { permissions: [...requested].sort() },
        ...context,
      },
      transaction,
    );
  });

  const refreshed = await list();
  const updated = refreshed.items.find((item) => item.id === roleId);

  if (!updated) {
    throw notFound();
  }

  return updated;
}

/** Exposed so the roles screen can never offer a permission nothing enforces. */
export function catalogKeys(): PermissionKey[] {
  return allPermissionKeys();
}
