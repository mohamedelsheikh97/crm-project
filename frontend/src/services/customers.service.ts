import { ApiError, http } from './http';

import type { Paged } from './admin-users.service';

export interface ContactMethod {
  id?: number;
  kind: 'phone' | 'email';
  /** What the user typed. This is always what a human is shown. */
  raw: string;
  /** Matching only — never rendered (contracts/customer-ui.md). */
  normalised?: string;
  isPrimary: boolean;
}

export interface CustomerSummary {
  id: number;
  displayName: string;
  company: string | null;
  isActive: boolean;
  primaryPhone: { raw: string; normalised: string } | null;
  primaryEmail: string | null;
  contactCount: number;
  createdAt: string;
  version: number;
  /** Which detail matched the search, so the list can explain itself. */
  matchedOn?: 'name' | 'company' | 'phone' | 'email';
}

export interface Customer extends CustomerSummary {
  address: string | null;
  contacts: ContactMethod[];
}

export interface DuplicateMatch {
  matchedOn: 'phone' | 'email';
  matchedValue: string;
  customer: {
    id: number;
    displayName: string;
    company: string | null;
    isActive: boolean;
    primaryPhone: { raw: string; normalised: string } | null;
    primaryEmail: string | null;
  };
}

export interface CustomerFilters {
  search?: string;
  company?: string;
  isActive?: boolean | 'all';
  page?: number;
  pageSize?: number;
}

export interface CustomerInput {
  displayName: string;
  company?: string | null;
  address?: string | null;
  contacts: Array<{ kind: 'phone' | 'email'; value: string; isPrimary: boolean }>;
  acknowledgeDuplicates?: boolean;
  version?: number;
}

function query(filters: CustomerFilters): string {
  const params = new URLSearchParams();

  if (filters.search) params.set('search', filters.search);
  if (filters.company) params.set('company', filters.company);
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/**
 * Pulls the matching records out of a 409 DUPLICATE_CUSTOMER.
 *
 * They arrive as a sibling of the error envelope rather than inside
 * `details[]`, so they are read from the error's payload.
 */
export function duplicatesFrom(cause: unknown): DuplicateMatch[] | null {
  if (cause instanceof ApiError && cause.code === 'DUPLICATE_CUSTOMER') {
    return (cause.payload.duplicates as DuplicateMatch[]) ?? [];
  }

  return null;
}

export async function list(filters: CustomerFilters = {}): Promise<Paged<CustomerSummary>> {
  return http.get<Paged<CustomerSummary>>(`/customers${query(filters)}`);
}

export async function get(id: number): Promise<Customer> {
  return http.get<Customer>(`/customers/${id}`);
}

export async function create(input: CustomerInput): Promise<Customer> {
  return http.post<Customer>('/customers', input);
}

export async function update(id: number, input: CustomerInput): Promise<Customer> {
  return http.patch<Customer>(`/customers/${id}`, input);
}

export async function deactivate(id: number): Promise<void> {
  await http.post<void>(`/customers/${id}/deactivate`);
}

export async function reactivate(id: number): Promise<void> {
  await http.post<void>(`/customers/${id}/reactivate`);
}

/**
 * Live feedback while typing — an AID, not the barrier.
 *
 * The barrier is the 409 on save, because a matching customer can be created
 * between a check and a save (research.md D5).
 */
export async function checkDuplicates(
  contacts: Array<{ kind: 'phone' | 'email'; value: string }>,
  excludeCustomerId: number | null = null,
): Promise<DuplicateMatch[]> {
  const result = await http.post<{ duplicates: DuplicateMatch[] }>('/customers/check-duplicates', {
    contacts,
    excludeCustomerId,
  });

  return result.duplicates;
}

/**
 * Downloads the filtered export.
 *
 * Goes through the authenticated wrapper rather than a plain link, because the
 * endpoint requires an Authorization header — an anchor tag would arrive
 * unauthenticated and be refused.
 */
export async function exportCsv(filters: CustomerFilters = {}): Promise<void> {
  const blob = await http.getBlob(`/customers/export${query(filters)}`);
  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'customers.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
