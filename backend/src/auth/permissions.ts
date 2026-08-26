/**
 * The permission catalog — the single source of truth for enforcement, for the
 * roles screen, and for the generated matrix test (research.md D2).
 *
 * This file lives outside `services/` deliberately: it is a declaration every
 * layer reads, not logic any layer runs.
 *
 * A later phase adds a module by extending PERMISSIONS and adding a grant to
 * the seeder. No migration is needed, because grants are keyed by string. A
 * key that is not listed here grants nothing, even if a row for it exists in
 * `role_permissions`.
 */

export interface PermissionDefinition {
  key: string;
  module: string;
  action: string;
  /** i18n key — never a literal label (Constitution Principle I). */
  nameKey: string;
}

function define(module: string, action: string): PermissionDefinition {
  return {
    key: `${module}:${action}`,
    module,
    action,
    nameKey: `permission.action.${module}.${action}`,
  };
}

export const PERMISSIONS = [
  define('users', 'view'),
  define('users', 'create'),
  define('users', 'update'),
  define('users', 'deactivate'),
  define('users', 'reset_password'),
  define('roles', 'view'),
  // No `roles:create` or `roles:delete` — the role set is fixed (FR-021).
  define('roles', 'update_permissions'),
  define('audit', 'view'),
  define('settings', 'view'),
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && PERMISSION_KEYS.has(value);
}

export function allPermissionKeys(): PermissionKey[] {
  return PERMISSIONS.map((p) => p.key as PermissionKey);
}

export interface PermissionModule {
  key: string;
  nameKey: string;
  actions: Array<{ key: string; nameKey: string }>;
}

/**
 * Module-grouped shape for GET /api/admin/permissions, so the roles screen can
 * never offer a permission nothing enforces.
 */
export function permissionCatalog(): PermissionModule[] {
  const modules = new Map<string, PermissionModule>();

  for (const permission of PERMISSIONS) {
    let entry = modules.get(permission.module);

    if (!entry) {
      entry = {
        key: permission.module,
        nameKey: `permission.module.${permission.module}`,
        actions: [],
      };
      modules.set(permission.module, entry);
    }

    entry.actions.push({ key: permission.key, nameKey: permission.nameKey });
  }

  return [...modules.values()];
}
