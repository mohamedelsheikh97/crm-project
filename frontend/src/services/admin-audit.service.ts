import { http } from './http';

import type { Paged } from './admin-users.service';

export interface AuditEntry {
  id: number;
  action: string;
  actor: { id: number | null; email: string | null } | null;
  target: { type: string | null; id: string | null; label: string | null };
  outcome: 'success' | 'failure';
  ipAddress: string | null;
  previousValue: unknown;
  newValue: unknown;
  metadata: unknown;
  createdAt: string;
}

export interface AuditFilters {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  actorUserId?: number;
  action?: string;
  outcome?: 'success' | 'failure';
}

export async function list(filters: AuditFilters = {}): Promise<Paged<AuditEntry>> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }

  const serialised = params.toString();

  return http.get<Paged<AuditEntry>>(`/admin/audit${serialised ? `?${serialised}` : ''}`);
}

export async function actions(): Promise<string[]> {
  return (await http.get<{ actions: string[] }>('/admin/audit/actions')).actions;
}
