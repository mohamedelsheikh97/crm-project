import { http } from './http';

export interface AdminRole {
  id: number;
  key: string;
  nameKey: string;
  descriptionKey: string;
  permissions: string[];
  userCount: number;
  version: number;
}

export interface PermissionModule {
  key: string;
  nameKey: string;
  actions: Array<{ key: string; nameKey: string }>;
}

export async function list(): Promise<{ items: AdminRole[] }> {
  return http.get<{ items: AdminRole[] }>('/admin/roles');
}

/**
 * The catalog comes from the server, never a client-side copy — that is what
 * stops the screen offering a permission nothing enforces (research.md D13).
 */
export async function permissionCatalog(): Promise<{ modules: PermissionModule[] }> {
  return http.get<{ modules: PermissionModule[] }>('/admin/permissions');
}

export async function replacePermissions(
  roleId: number,
  permissions: string[],
  version: number,
): Promise<AdminRole> {
  return http.put<AdminRole>(`/admin/roles/${roleId}/permissions`, { permissions, version });
}
