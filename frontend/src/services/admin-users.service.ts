import { http } from './http';

export interface AdminUser {
  id: number;
  email: string;
  fullName: string;
  role: { key: string; nameKey: string };
  isActive: boolean;
  isLocked: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  version: number;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UserFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  roleKey?: string;
  isActive?: boolean;
}

function query(filters: UserFilters): string {
  const params = new URLSearchParams();

  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.search) params.set('search', filters.search);
  if (filters.roleKey) params.set('roleKey', filters.roleKey);
  if (typeof filters.isActive === 'boolean') params.set('isActive', String(filters.isActive));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

export async function list(filters: UserFilters = {}): Promise<Paged<AdminUser>> {
  return http.get<Paged<AdminUser>>(`/admin/users${query(filters)}`);
}

export async function get(id: number): Promise<AdminUser> {
  return http.get<AdminUser>(`/admin/users/${id}`);
}

export async function create(input: {
  email: string;
  fullName: string;
  roleKey: string;
  initialPassword: string;
}): Promise<AdminUser> {
  return http.post<AdminUser>('/admin/users', input);
}

export async function update(
  id: number,
  input: { fullName?: string; roleKey?: string; version: number },
): Promise<AdminUser> {
  return http.patch<AdminUser>(`/admin/users/${id}`, input);
}

export async function deactivate(id: number): Promise<void> {
  await http.post<void>(`/admin/users/${id}/deactivate`);
}

export async function reactivate(id: number): Promise<void> {
  await http.post<void>(`/admin/users/${id}/reactivate`);
}

export async function resetPassword(id: number, newPassword: string): Promise<void> {
  await http.post<void>(`/admin/users/${id}/reset-password`, { newPassword });
}

export async function unlock(id: number): Promise<void> {
  await http.post<void>(`/admin/users/${id}/unlock`);
}
