/**
 * Which system owns which customer field (Phase 11, US4, FR-042).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THESE DEFAULTS ARE A PLACEHOLDER. THE REAL ANSWER IS OPERATIONAL.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Which system owns `email` versus `taxId` is a business decision, not a
 * technical one — research open question 4, and task T115 is somebody sitting
 * down with operations to settle it. Getting it wrong means either agents'
 * corrections being reverted nightly, or the ERP being permanently stale.
 *
 * It is declared HERE, in one file, rather than inline in the sync so that
 * changing it is an edit to a table somebody can read and check.
 *
 * The reasoning behind each default, so a reviewer can disagree with something
 * specific:
 *
 *   `erp`  — the ERP is the system of record for identity and billing. A tax
 *            identifier and a postal address are what invoices are raised
 *            against; if they disagree, the ERP is right by definition.
 *   `crm`  — this system is where a person corrects a contact detail during a
 *            call. An agent who has just been told "that's my old number"
 *            updates it here, and a sync that reverted that overnight would
 *            make the correction pointless and the agent stop bothering.
 *   `none` — never synchronised in either direction.
 */
export type FieldOwner = 'erp' | 'crm';

/**
 * Keyed by the CRM column, valued by who wins a disagreement.
 *
 * A field absent from this map is never written by a sync at all, which is the
 * safe default: adding a field to `ErpCustomer` does not silently start
 * overwriting something.
 */
export const FIELD_OWNERSHIP: Readonly<Record<string, FieldOwner>> = {
  // Identity and billing — the ERP raises the invoices.
  display_name: 'erp',
  company: 'erp',
  tax_id: 'erp',
  address: 'erp',

  // Contact details — corrected here, during a conversation.
  email: 'crm',
  phone: 'crm',
};

/** Fields a sync may write at all. */
export const SYNCABLE_FIELDS = Object.keys(FIELD_OWNERSHIP);

export function ownerOf(field: string): FieldOwner | null {
  return FIELD_OWNERSHIP[field] ?? null;
}
