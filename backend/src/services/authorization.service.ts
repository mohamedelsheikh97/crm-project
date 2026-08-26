import { isPermissionKey, type PermissionKey } from '../auth/permissions.js';
import { forbidden } from '../errors/app-error.js';
import { RolePermission } from '../models/index.js';

/**
 * The ONLY place a permission decision is made (Constitution Principle III).
 *
 * `requirePermission` middleware translates an answer into a response; it never
 * computes one. No controller, route handler, or model contains a role
 * comparison or a permission lookup.
 *
 * State is read on every call rather than cached. That is the design, not an
 * oversight: FR-016 forbids deciding from token claims, and FR-007/FR-017 cap
 * propagation at 60 seconds — reading current state makes the delay zero
 * (research.md D1). A cache would add an invalidation problem to optimise a
 * system with no measured load. This boundary exists so one can be added later
 * without touching a single call site.
 */
export async function getRolePermissions(roleId: number): Promise<Set<PermissionKey>> {
  const rows = await RolePermission.findAll({
    where: { role_id: roleId },
    attributes: ['permission_key'],
  });

  const granted = new Set<PermissionKey>();

  for (const row of rows) {
    // A row whose key is not in the current catalog grants nothing. This is
    // what lets a module be renamed or removed in a later phase without
    // invalidating the table (spec Edge Cases).
    if (isPermissionKey(row.permission_key)) {
      granted.add(row.permission_key);
    }
  }

  return granted;
}

export async function roleHasPermission(roleId: number, key: PermissionKey): Promise<boolean> {
  const granted = await getRolePermissions(roleId);
  return granted.has(key);
}

export async function assertPermission(roleId: number, key: PermissionKey): Promise<void> {
  if (!(await roleHasPermission(roleId, key))) {
    throw forbidden();
  }
}

/** Which roles grant a given key — used by the FR-018 lockout guard. */
export async function rolesGranting(key: PermissionKey): Promise<number[]> {
  const rows = await RolePermission.findAll({
    where: { permission_key: key },
    attributes: ['role_id'],
  });

  return rows.map((row) => row.role_id);
}
