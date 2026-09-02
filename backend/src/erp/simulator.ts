import {
  ErpUnavailableError,
  type ErpAdapter,
  type ErpAdapterInfo,
  type ErpCustomer,
  type ErpCustomerQuery,
  type ErpInvalidRecord,
  type ErpOrder,
  type ErpPage,
} from './types.js';

/**
 * The shipped implementation of the adapter contract (Phase 11, US4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT CONTAINS THE AWKWARD CASES ON PURPOSE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A simulator that returned nine well-formed customers would let every
 * requirement in FR-039 to FR-051 pass without exercising the ones that matter.
 * Each record below exists because some requirement turns on it, and the comment
 * says which — so somebody trimming the fixture can see what they would be
 * switching off.
 *
 * IT CAN FAIL ON DEMAND. "The ERP is unreachable" is a requirement in three
 * places (FR-054, SC-021, and the run-fails-visibly edge case), and a simulator
 * that always succeeds cannot test any of them.
 *
 * IT IS A VERIFICATION TOOL, NOT A FALLBACK. When a real adapter is configured
 * this must not be reachable (FR-039a) — it is not graceful degradation for an
 * ERP being down, because that case is an error state on the screen.
 */

const KEY = 'simulator';

let failing = false;

/** Makes every call throw `ErpUnavailableError` until cleared. */
export function setFailing(value: boolean): void {
  failing = value;
}

function guard(): void {
  if (failing) {
    throw new ErpUnavailableError('the simulator is in its failing mode');
  }
}

function at(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

interface SimulatedCustomer extends ErpCustomer {
  /** Why this record is in the fixture. Read before removing one. */
  readonly why: string;
  /** Thrown instead of returned, for the skip paths. */
  readonly invalidReason?: string;
}

const CUSTOMERS: readonly SimulatedCustomer[] = [
  {
    externalId: 'ERP-1001',
    displayName: 'Northwind Trading',
    type: 'company',
    taxId: 'TX-1001',
    phone: '+201000000001',
    email: 'accounts@northwind.example',
    addressLine: '1 Nile Street',
    city: 'Cairo',
    country: 'EG',
    updatedAt: at(2026, 8, 1),
    isArchived: false,
    why: 'no counterpart here — tests CREATION (FR-041)',
  },
  {
    externalId: 'ERP-1002',
    displayName: 'Contoso Ltd',
    type: 'company',
    taxId: 'TX-1002-CHANGED',
    phone: '+201000000002',
    email: 'ap@contoso.example',
    addressLine: '2 Corniche Road',
    city: 'Alexandria',
    country: 'EG',
    updatedAt: at(2026, 8, 2),
    isArchived: false,
    why: 'counterpart exists with a changed ERP-owned field — tests UPDATE (FR-042)',
  },
  {
    externalId: 'ERP-1003',
    displayName: 'Fabrikam',
    type: 'company',
    taxId: 'TX-1003',
    // The CRM value for this customer was edited by a person more recently. The
    // ownership table gives `email` to the CRM, so this must NOT win.
    phone: '+201000000003',
    email: 'erp-address@fabrikam.example',
    addressLine: '3 Tahrir Square',
    city: 'Giza',
    country: 'EG',
    updatedAt: at(2026, 8, 3),
    isArchived: false,
    why: 'a field a person edited here more recently — tests FR-043, THE IMPORTANT ONE',
  },
  {
    externalId: 'ERP-1004',
    // Missing a required field. `listCustomers` throws for this one.
    displayName: '',
    type: null,
    taxId: null,
    phone: null,
    email: null,
    addressLine: null,
    city: null,
    country: null,
    updatedAt: at(2026, 8, 4),
    isArchived: false,
    why: 'missing a required field — tests the SKIP with a reason (FR-046)',
    invalidReason: 'displayName is empty',
  },
  {
    externalId: 'ERP-1005',
    displayName: 'Adventure Works',
    type: 'company',
    taxId: 'TX-1005',
    phone: '+201000000005',
    // Rejected by this system's own validation, so it must be skipped rather
    // than written past it.
    email: 'not-an-email-address',
    addressLine: '5 Pyramid Way',
    city: 'Giza',
    country: 'EG',
    updatedAt: at(2026, 8, 5),
    isArchived: false,
    why: "a value this system's validation rejects — tests FR-047",
  },
  {
    externalId: 'ERP-1006',
    displayName: 'Tailspin Toys',
    type: 'company',
    taxId: 'TX-1006',
    phone: '+201000000006',
    email: 'hello@tailspin.example',
    addressLine: '6 Ring Road',
    city: 'Cairo',
    country: 'EG',
    updatedAt: at(2026, 8, 6),
    // Archived there, active here. REPORTED, never deactivated (FR-050):
    // deactivation in this system has consequences — portal access, ticket
    // routing — that the ERP does not know about.
    isArchived: true,
    why: 'archived in the ERP while active here — tests FR-050',
  },
  {
    externalId: 'ERP-1007',
    displayName: 'Wingtip Toys',
    type: 'company',
    taxId: 'TX-1007',
    phone: '+201000000007',
    email: 'orders@wingtip.example',
    addressLine: '7 Corniche',
    city: 'Alexandria',
    country: 'EG',
    updatedAt: at(2026, 8, 7),
    isArchived: false,
    why: 'has several orders — tests the order display (FR-052)',
  },
  {
    externalId: 'ERP-1008',
    displayName: 'Litware',
    type: 'individual',
    taxId: null,
    phone: '+201000000008',
    email: 'litware@example.org',
    addressLine: null,
    city: null,
    country: 'EG',
    updatedAt: at(2026, 8, 8),
    isArchived: false,
    why: 'has NO orders — tests that "no orders" differs from "cannot reach" (FR-054)',
  },
  /**
   * A DUPLICATE `externalId`, and it earned its place by finding a real bug.
   *
   * The comment here used to say the unique index refuses it. It does not: the
   * index stops two LINKS claiming one identifier, while a second ERP record
   * simply finds the existing link and updates it. Because these two records
   * disagree, that produced an endless ping-pong in which every run reported a
   * change and flagged it as a human edit — a permanent phantom conflict on a
   * customer nobody had touched.
   *
   * The sync now skips a repeat within a run with a reason. This record is what
   * keeps that true.
   */
  {
    externalId: 'ERP-1001',
    displayName: 'Northwind Trading (duplicate)',
    type: 'company',
    taxId: 'TX-1001-DUP',
    phone: null,
    email: null,
    addressLine: null,
    city: null,
    country: 'EG',
    updatedAt: at(2026, 8, 9),
    isArchived: false,
    why: 'two records sharing an externalId — tests the uniqueness refusal',
  },
  // Enough beyond the default page size to page more than once, so resumption
  // has somewhere to resume from.
  ...Array.from({ length: 6 }, (_unused, index) => ({
    externalId: `ERP-20${String(index).padStart(2, '0')}`,
    displayName: `Filler Company ${index}`,
    type: 'company' as const,
    taxId: `TX-20${index}`,
    phone: null,
    email: null,
    addressLine: null,
    city: 'Cairo',
    country: 'EG',
    updatedAt: at(2026, 8, 10 + index),
    isArchived: false,
    why: 'volume, so the run pages more than once — tests resumption (FR-045)',
  })),
];

const ORDERS: Readonly<Record<string, readonly ErpOrder[]>> = {
  'ERP-1007': [
    {
      externalId: 'SO-9001',
      reference: 'SO-9001',
      placedAt: at(2026, 7, 14),
      status: 'shipped',
      total: 1250.5,
      currency: 'EGP',
    },
    {
      externalId: 'SO-9002',
      reference: 'SO-9002',
      placedAt: at(2026, 8, 2),
      // Deliberately not one of a fixed set: the contract makes status a free
      // string because every ERP has its own vocabulary.
      status: 'awaiting picking',
      total: 340,
      currency: 'EGP',
    },
    {
      externalId: 'SO-9003',
      reference: 'SO-9003',
      placedAt: at(2026, 8, 20),
      status: 'cancelled',
      total: 0,
      currency: 'EGP',
    },
  ],
  // ERP-1008 is absent rather than empty — the adapter answers with no orders,
  // which the screen must render differently from a failure.
};

const PAGE_SIZE = 5;

export const simulatorAdapter: ErpAdapter = {
  describe(): ErpAdapterInfo {
    return {
      key: KEY,
      label: 'Simulator (no real ERP connected)',
      // The whole reason this field is on the contract.
      isSimulated: true,
    };
  },

  async listCustomers(query: ErpCustomerQuery): Promise<ErpPage<ErpCustomer>> {
    guard();

    const eligible = CUSTOMERS.filter(
      (customer) => query.since === null || customer.updatedAt >= query.since,
    );

    /**
     * Tolerant of a null or undefined cursor, and of a malformed one.
     *
     * The contract says the cursor is opaque and handed back verbatim, so an
     * adapter must not assume it is well-formed. Defaulting to 0 rather than NaN
     * means a bad cursor RESTARTS the page rather than silently returning
     * nothing — and returning nothing is exactly what let a broken sync report
     * success while doing no work.
     */
    const parsed = Number(query.cursor ?? 0);
    const offset = Number.isFinite(parsed) ? parsed : 0;
    const size = Math.min(query.limit, PAGE_SIZE);
    const slice = eligible.slice(offset, offset + size);

    /**
     * An invalid record is REPORTED ALONGSIDE the good ones, not thrown.
     *
     * Throwing was the first design and it was wrong: it abandoned the whole
     * page, so the good records either side of a bad one were never processed —
     * which is precisely what FR-046 forbids. `ErpPage.invalid` carries them
     * instead, and the sync records each as a skip with its reason and keeps
     * going.
     */
    const items: ErpCustomer[] = [];
    const invalid: ErpInvalidRecord[] = [];

    for (const customer of slice) {
      if (customer.invalidReason) {
        invalid.push({ externalId: customer.externalId, reason: customer.invalidReason });
        continue;
      }

      const { why: _why, invalidReason: _invalid, ...rest } = customer;

      items.push(rest);
    }

    return {
      items,
      invalid,
      nextCursor: offset + size < eligible.length ? String(offset + size) : null,
    };
  },

  async getOrdersFor(externalCustomerId: string): Promise<readonly ErpOrder[]> {
    guard();

    return ORDERS[externalCustomerId] ?? [];
  },
};

/**
 * The one record the sync must not overwrite, exposed for the tests.
 *
 * Named rather than found by index, so a test asserting FR-043 says what it is
 * asserting about.
 */
export const HUMAN_EDIT_FIXTURE = {
  externalId: 'ERP-1003',
  /** The ownership table gives `email` to the CRM, so this must survive. */
  crmOwnedField: 'email',
  erpValue: 'erp-address@fabrikam.example',
} as const;
