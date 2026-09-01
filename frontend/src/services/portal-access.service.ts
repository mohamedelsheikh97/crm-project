import { request } from './http';

/**
 * The STAFF side of portal access (Phase 8, FR-056 - FR-060a).
 *
 * Goes through `http.ts` — the staff client — because the caller is a signed-in
 * member of staff holding `portal:manage`. The portal's own client is for
 * customers, and nothing here is reachable by one.
 */

export type PortalAccessStatus = 'none' | 'invited' | 'active' | 'locked' | 'withdrawn';

export interface PortalAccessRow {
  contactId: number;
  email: string;
  accountId: number | null;
  status: PortalAccessStatus;
  invitationId: number | null;
}

export async function overview(customerId: number): Promise<PortalAccessRow[]> {
  const response = await request<{ items: PortalAccessRow[] }>(
    `/customers/${customerId}/portal-access`,
  );

  return response.items;
}

export function invite(
  customerId: number,
  contactId: number,
): Promise<{ invitationId: number; email: string; provisionalWarning: boolean }> {
  return request(`/customers/${customerId}/contacts/${contactId}/portal-invitations`, {
    method: 'POST',
    // NO BODY. The address is not a parameter — it comes from the contact the
    // path names, which is what stops an invitation being redirected to an
    // address of the issuer's choosing (FR-002d).
    body: JSON.stringify({}),
  });
}

export function sendReset(customerId: number, contactId: number): Promise<void> {
  return request(`/customers/${customerId}/contacts/${contactId}/portal-reset`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function revokeInvitation(invitationId: number): Promise<void> {
  return request(`/admin/portal/invitations/${invitationId}`, { method: 'DELETE' });
}

export function withdraw(accountId: number): Promise<void> {
  return request(`/admin/portal/accounts/${accountId}/withdraw`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function restore(accountId: number): Promise<void> {
  return request(`/admin/portal/accounts/${accountId}/restore`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function unlock(accountId: number): Promise<void> {
  return request(`/admin/portal/accounts/${accountId}/unlock`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Records which contact raised a ticket (FR-026h, FR-057a).
 *
 * On the ticket rather than the customer, because that is where a staff member
 * is standing when they find out the customer cannot see their own request.
 */
export function setRequestingContact(
  ticketId: number,
  requestingContactId: number | null,
): Promise<unknown> {
  return request(`/tickets/${ticketId}/requesting-contact`, {
    method: 'PATCH',
    body: JSON.stringify({ requestingContactId }),
  });
}
