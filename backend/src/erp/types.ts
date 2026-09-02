/**
 * THE ERP ADAPTER CONTRACT (Phase 11, US4, FR-039, FR-039b, FR-040).
 *
 * The only thing the synchronisation and the order display depend on. Naming a
 * specific ERP product is deliberately deferred (spec Clarifications Q1): which
 * ERP the organisation runs is a fact about them, not a design decision, and
 * every requirement in FR-040 to FR-051 is a property of the SYNCHRONISATION
 * rather than of any particular product.
 *
 * Phase 5 ran this play successfully for communication channels: a declared
 * contract, simulators behind it, real adapters later without the intake
 * pipeline changing.
 *
 * THREE METHODS, DELIBERATELY. Every addition is something a future ERP has to
 * provide. `getOrdersFor` is separate from `listCustomers` rather than an
 * include, because the customer screen fetches orders on its own request with
 * its own timeout and must not pull a sync's worth of work with it.
 */

export interface ErpCustomer {
  /**
   * The ERP's identifier, and the contract says STABLE FOREVER rather than
   * merely unique. An identifier that changes for the same real customer
   * creates a second customer here — a problem to solve in the adapter.
   */
  readonly externalId: string;
  readonly displayName: string;
  readonly type: 'company' | 'individual' | null;
  readonly taxId: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly country: string | null;
  /**
   * When the ERP last changed this record. MANDATORY: an adapter that cannot
   * say this cannot support incremental sync, and the fallback — reading
   * everything every time — is what makes a nightly sync take hours at 100,000
   * customers.
   */
  readonly updatedAt: Date;
  /** The ERP considers it inactive. REPORTED here, never acted on (FR-050). */
  readonly isArchived: boolean;
}

export interface ErpOrder {
  readonly externalId: string;
  readonly reference: string;
  readonly placedAt: Date;
  /**
   * A FREE STRING, not an enum. Every ERP has its own vocabulary, and inventing
   * a canonical set would force each adapter to map into it — losing
   * information, and demanding a decision about what "partially shipped"
   * becomes. The agent reads it; nothing branches on it.
   */
  readonly status: string;
  /**
   * A NUMBER, with the currency separate. Not a formatted string: the screen
   * formats through `vue-i18n`, and an ERP handing us "£1,234.56" would put
   * Latin digits on an Arabic screen with nothing the display could do about it.
   */
  readonly total: number;
  readonly currency: string;
}

export interface ErpCustomerQuery {
  readonly since: Date | null;
  readonly cursor: string | null;
  readonly limit: number;
}

/** One row the adapter could not turn into an `ErpCustomer`. */
export interface ErpInvalidRecord {
  readonly externalId: string;
  readonly reason: string;
}

export interface ErpPage<T> {
  readonly items: readonly T[];
  /**
   * Rows in THIS page the adapter could not produce, with a reason each.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * PER-RECORD FAILURES TRAVEL WITH THE PAGE. THEY DO NOT THROW.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The first version of this contract had the adapter THROW
   * `ErpRecordInvalidError` for a bad row, and it was wrong in a way that only
   * showed up under test: a throw from `listCustomers` abandons the WHOLE PAGE,
   * so the good records either side of a bad one were never processed. FR-046
   * requires one bad row not to stop the other 9,999 — and a design where the
   * page is the unit of failure cannot deliver that.
   *
   * Carrying them alongside the good records is what makes the requirement
   * actually hold: the sync records each as a skip with its reason, and keeps
   * going. `ErpUnavailableError` is still a throw, because that genuinely IS
   * page-level — the ERP went away, and there is nothing to salvage.
   */
  readonly invalid: readonly ErpInvalidRecord[];
  /** Opaque to us; handed back verbatim on the next call. */
  readonly nextCursor: string | null;
}

export interface ErpAdapterInfo {
  readonly key: string;
  readonly label: string;
  /**
   * DISPLAYED PROMINENTLY wherever this adapter's data appears (FR-039a).
   *
   * A deployment serving simulated orders to an agent who believes they are
   * real is the quiet failure this phase can most easily ship: the screen works,
   * the data is plausible, and the agent quotes it to a customer. The flag is on
   * the contract rather than inferred from the provider name so a real adapter
   * cannot forget to say what it is.
   */
  readonly isSimulated: boolean;
}

export interface ErpAdapter {
  describe(): ErpAdapterInfo;
  listCustomers(query: ErpCustomerQuery): Promise<ErpPage<ErpCustomer>>;
  getOrdersFor(externalCustomerId: string): Promise<readonly ErpOrder[]>;
}

/**
 * The ERP is unreachable, mis-authenticated, or answering 5xx.
 *
 * FAILS THE WHOLE RUN and changes nothing. Half a sync applied against an ERP
 * that then went away is worse than no sync, because nobody knows how far it
 * got.
 */
export class ErpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErpUnavailableError';
  }
}

/**
 * One record is unusable, thrown from a SINGLE-RECORD call.
 *
 * `listCustomers` must NOT throw this — it reports per-record failures through
 * `ErpPage.invalid`, because a throw would abandon the whole page and FR-046
 * requires one bad row not to stop the rest. This exists for `getOrdersFor`,
 * which concerns one customer and where a throw costs nothing else.
 */
export class ErpRecordInvalidError extends Error {
  constructor(
    readonly externalId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ErpRecordInvalidError';
  }
}
