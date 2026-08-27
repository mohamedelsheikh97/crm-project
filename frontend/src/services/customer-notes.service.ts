import { http } from './http';

import type { Paged } from './admin-users.service';

export interface CustomerNote {
  id: number;
  body: string;
  author: { id: number; fullName: string };
  createdAt: string;
  /** Non-null means a human changed what this says (FR-026). */
  editedAt: string | null;
}

export async function list(customerId: number, page = 1): Promise<Paged<CustomerNote>> {
  return http.get<Paged<CustomerNote>>(`/customers/${customerId}/notes?page=${page}`);
}

export async function create(customerId: number, body: string): Promise<CustomerNote> {
  return http.post<CustomerNote>(`/customers/${customerId}/notes`, { body });
}

export async function update(
  customerId: number,
  noteId: number,
  body: string,
): Promise<CustomerNote> {
  return http.patch<CustomerNote>(`/customers/${customerId}/notes/${noteId}`, { body });
}

export async function remove(customerId: number, noteId: number): Promise<void> {
  await http.delete<void>(`/customers/${customerId}/notes/${noteId}`);
}
