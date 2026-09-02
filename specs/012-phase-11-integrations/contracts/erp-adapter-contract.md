# Contract: The ERP Adapter

**Feature**: Phase 11 — Integrations | **Audience**: whoever wires a real ERP to this system

This is the boundary Clarifications Q1 chose in place of naming a product. Everything the
synchronisation and the order display need is expressed here; nothing outside this file knows what
the ERP is.

The precedent is `channels/registry.ts`. Phase 5 had no real WhatsApp, SMS or email provider
available, so it declared a channel contract, shipped simulators behind it, and made every channel
requirement testable immediately. The real adapters arrived later without the intake pipeline
changing. This is the same play.

---

## 1. What an adapter must provide

```ts
export interface ErpAdapter {
  /** Identity, for the administration screen. See section 5. */
  describe(): ErpAdapterInfo;

  /** Customers changed at or after `since`, paged by the ERP's own cursor. */
  listCustomers(query: ErpCustomerQuery): Promise<ErpPage<ErpCustomer>>;

  /** Orders for one ERP customer. Read-only. */
  getOrdersFor(externalCustomerId: string): Promise<ErpOrder[]>;
}
```

Three methods. Deliberately not more: every additional method is something a future ERP has to
provide, and the ones here are the minimum the six user stories need. `getOrdersFor` is separate from
`listCustomers` rather than an include, because the customer screen fetches orders on its own request
with its own timeout (research D14) and must not pull a customer sync's worth of work with it.

---

## 2. The shapes

```ts
export interface ErpCustomer {
  /** The ERP's identifier. Stable forever — this is the link. See section 4. */
  externalId: string;
  displayName: string;
  type: 'company' | 'individual' | null;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  /** When the ERP last changed this record. Drives `since` and conflict detection. */
  updatedAt: Date;
  /** True if the ERP considers the customer inactive. See section 4. */
  isArchived: boolean;
}

export interface ErpOrder {
  externalId: string;
  reference: string;
  placedAt: Date;
  status: string;
  total: number;
  currency: string;
}

export interface ErpCustomerQuery {
  since: Date | null;
  cursor: string | null;
  limit: number;
}

export interface ErpPage<T> {
  items: T[];
  /** Opaque to us; handed back verbatim on the next call. */
  nextCursor: string | null;
}
```

**`ErpOrder.status` is a free string, not an enum.** Every ERP has its own vocabulary and inventing a
canonical set here would mean each adapter mapping into it — losing information, and forcing a
decision about what "partially shipped" becomes. The agent reads it; nothing branches on it. The
consequence is stated: an order status is display text, so it is not translated, and the order panel
labels it as coming from the ERP.

**`total` is a number and `currency` is separate.** Not a formatted string, because the screen formats
through `vue-i18n` — an ERP handing us "£1,234.56" would put Latin digits on an Arabic screen and
there would be nothing the display could do about it.

**`updatedAt` is mandatory.** An adapter that cannot say when a record last changed cannot support
incremental sync, and the fallback — reading everything every time — is what makes a nightly sync
take hours at 100,000 customers.

---

## 3. Errors an adapter may throw

```ts
export class ErpUnavailableError extends Error {} // network, auth, 5xx — retry later
export class ErpRecordInvalidError extends Error {} // this record is unusable; skip it
```

The distinction decides what happens to the run:

- `ErpUnavailableError` **fails the whole run** and changes nothing (spec edge case: "the ERP is
  unreachable when a sync starts"). Half a sync applied against an ERP that then went away is worse
  than no sync, because nobody knows how far it got.
- `ErpRecordInvalidError` **skips one record with a reason** and continues (FR-046). One bad row must
  not stop the other 9,999.

Anything else an adapter throws is treated as `ErpUnavailableError` — the conservative reading, since
an unclassified failure is not evidence that the rest of the data is good.

---

## 4. Rules the synchronisation applies, which an adapter does not need to know

These are stated here so an adapter author knows what will happen to the data they return.

**Linking.** `externalId` is the correspondence, stored on `erp_links`, unique on both sides. An
`externalId` that changes for the same real customer creates a second customer here — which is why
the contract says "stable forever" rather than "unique". If an ERP recycles or renumbers
identifiers, that is a problem to solve in the adapter, not here.

**Field ownership.** Each field has a declared owner. The declaration is an operational decision
somebody has to make with the organisation (research open question 4), not a technical one — a
plausible default has the ERP owning `taxId` and address fields, and this system owning `email` and
`phone`, because those are what an agent corrects during a call.

**Human edits are protected.** `erp_links.last_synced_values` holds what the sync last wrote. If the
current value differs, a person changed it, and FR-043 applies: the human edit is preserved, or
replaced with the replacement recorded and visible. Never silently overwritten. An adapter cannot
cause this to be skipped.

**Validation is not bypassed.** A value this system would reject from a person is rejected from the
ERP too, and the record is skipped with the reason reported (FR-047). An adapter returning a
malformed email address gets a skip, not a write past validation.

**`isArchived` does not deactivate.** A customer archived in the ERP is *reported*, not deactivated
here, and a customer deactivated here is never reactivated by a sync (FR-050). Deactivation in this
system has consequences — portal access, ticket routing — that the ERP does not know about.

**Customers with no ERP counterpart are left alone** (FR-051). This system is not a subset of the ERP.

---

## 5. Selecting an adapter

Exactly as `channels/registry.ts` does it:

```ts
// erp/registry.ts
export function adapter(): ErpAdapter {
  return env.ERP_PROVIDER === 'simulator' ? simulatorAdapter : /* a real one */ simulatorAdapter;
}
```

**The provider comes from the environment, because it decides which code runs. Enablement comes from
the database, because an administrator changes it at runtime.** That division is Phase 5's and it is
what FR-039a needs: ERP sync can be switched off without a deployment, and cannot be re-pointed at a
different adapter through a screen.

`describe()` exists for FR-039a's second half:

```ts
export interface ErpAdapterInfo {
  key: string; // 'simulator'
  label: string; // 'Simulator (no real ERP connected)'
  isSimulated: boolean;
}
```

**`isSimulated` is displayed prominently on the ERP administration screen and beside order data.** A
deployment serving simulated orders to an agent who believes they are real is the quiet failure this
phase can most easily ship — the screen works, the data is plausible, and the agent quotes it to a
customer. The flag is the defence, and it is on the contract rather than inferred from the provider
name so that a real adapter cannot forget to say what it is.

---

## 6. The simulator

`erp/simulator.ts` implements the contract against an in-memory fixture, and it is what makes every
requirement in spec sections FR-039 to FR-057 exercisable now.

It must contain, because these are the cases the requirements turn on:

- a customer with no counterpart here (tests creation)
- a customer whose counterpart exists with one changed field (tests update)
- a customer whose counterpart has a field a person edited here more recently (tests FR-043 — the
  requirement whose failure is most damaging)
- a record missing a required field (tests FR-046's skip-with-reason)
- a record whose value this system's validation rejects (tests FR-047)
- two records sharing an `externalId` (tests the uniqueness refusal)
- a customer archived in the ERP whose counterpart is active here (tests FR-050)
- a customer with several orders, and one with none (tests FR-054's distinction between "no orders"
  and "cannot reach")
- enough records to page more than once (tests resumption)

It must also be able to **fail on demand** — throw `ErpUnavailableError` — because "the ERP is
unreachable" is a requirement in three places (FR-054, SC-021, and the run-fails-visibly edge case)
and a simulator that always succeeds cannot test any of them.

**The simulator is a verification tool, not a fallback.** When a real adapter is configured the
simulator must not be reachable (FR-039a). It is not a graceful degradation for an ERP being down —
that case is an error state on the screen, which is the whole point of FR-054.

---

## 7. Adding a real adapter later

The intended shape of that work, so that the claim "implements one interface and touches nothing
else" is falsifiable:

1. `erp/<product>/adapter.ts` implementing `ErpAdapter`.
2. A branch in `erp/registry.ts` and a value for `ERP_PROVIDER`.
3. Connection settings in the environment schema (`config/env.ts`) — never in a table, so they cannot
   be echoed by an administration screen (FR-066).
4. A conformance test suite run against **both** the simulator and the new adapter, so the contract
   is what is tested rather than one implementation of it.

Nothing in `services/erp-sync.service.ts`, `services/erp-order.service.ts`, the migrations, the
administration screens or the customer screen should need to change. If it does, this contract is
missing something, and the fix belongs here rather than at the call site.
