import type { CustomerDetail, CustomerSummary } from '../../../services/customer.service.js';

/**
 * Service output → the published customer shape (Phase 11, FR-003, research D6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PRESENTER MAY NOT QUERY. THAT IS THE WHOLE POINT OF THE LAYER.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FR-010 forbids the published interface restating business rules, and the way
 * that gets broken is mundane: an endpoint needs a field no service returns, and
 * the tempting fix is a small query right here. That query then becomes a second
 * definition of what a customer IS — of which contact is primary, of whether a
 * provisional record counts — and it will disagree with the screens on the first
 * change to either.
 *
 * So this file takes what `customer.service.ts` already produced and renames it.
 * `backend/tests/api/no-rule-restatement.test.ts` asserts no presenter imports a
 * model.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `snake_case`, AND THAT IS NOT AN OVERSIGHT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The internal interface uses `camelCase`. Sharing a serialisation would make
 * every internal rename a breaking API change — which is precisely what
 * versioning exists to avoid. The translation happens here and only here, so the
 * published shape can hold still while the service beneath it changes freely.
 */

export interface PublishedCustomer {
  readonly id: number;
  readonly display_name: string;
  readonly company: string | null;
  readonly is_active: boolean;
  /**
   * TRUE means this system created the record from an unrecognised sender and
   * nobody has confirmed who it is (Phase 5, FR-014b).
   *
   * Published deliberately. A client synchronising customers needs to know a
   * record is a guess rather than an onboarding, or it will treat a provisional
   * row as an established relationship.
   */
  readonly is_provisional: boolean;
  readonly primary_email: string | null;
  readonly primary_phone: string | null;
  readonly contact_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PublishedCustomerDetail extends PublishedCustomer {
  readonly address: string | null;
  readonly contacts: ReadonlyArray<{
    readonly id: number;
    readonly kind: string;
    readonly value: string;
    readonly is_primary: boolean;
  }>;
}

/**
 * `primary_phone` is the RAW value, not the normalised one.
 *
 * The normalised form is this system's matching key — an implementation detail
 * of identity resolution, and publishing it would invite a client to depend on
 * our normalisation rules. The raw value is what a person typed and what the
 * customer would recognise.
 */
export function customer(summary: CustomerSummary & { updated_at?: Date }): PublishedCustomer {
  return {
    id: summary.id,
    display_name: summary.displayName,
    company: summary.company,
    is_active: summary.isActive,
    is_provisional: summary.isProvisional,
    primary_email: summary.primaryEmail,
    primary_phone: summary.primaryPhone?.raw ?? null,
    contact_count: summary.contactCount,
    created_at: summary.createdAt.toISOString(),
    updated_at: summary.updatedAt.toISOString(),
  };
}

export function customerDetail(detail: CustomerDetail): PublishedCustomerDetail {
  return {
    ...customer(detail),
    address: detail.address,
    contacts: detail.contacts.map((contact) => ({
      id: contact.id,
      kind: contact.kind,
      // Raw again, for the same reason.
      value: contact.raw,
      is_primary: contact.isPrimary,
    })),
  };
}
