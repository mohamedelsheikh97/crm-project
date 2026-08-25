# UI Contract: Application Shell (Phase 0)

**Feature**: `001-phase-0-foundation` | **Date**: 2026-08-25

Phase 0 ships no business screens. What it ships is the shell every screen in Phases 1–12
inherits, so these contracts constrain all later UI work.

---

## Root document contract (FR-022)

The `<html>` element MUST always reflect the active locale:

| Active locale | `lang` | `dir` |
|---|---|---|
| English | `en` | `ltr` |
| Arabic | `ar` | `rtl` |

Both attributes update on language switch **without a page reload** (FR-011), and are applied
**before first paint** on load by reading persisted state synchronously — otherwise Arabic users
see a flash of left-to-right layout.

---

## Layout landmark contract (FR-023)

The base layout MUST expose semantic landmarks that later screens slot into:

```text
<header>   — app bar; contains the language toggle
<nav>      — primary navigation region (empty in Phase 0, populated from Phase 1)
<main>     — routed view target; exactly one per page
<footer>   — optional
```

Rules for later phases: exactly one `<main>` per rendered page, and feature screens render
*inside* `<main>` rather than replacing the shell.

---

## Language toggle contract (FR-024)

- Rendered in `<header>`.
- A real `<button>` (not a `div`), reachable and operable by keyboard alone.
- Has an accessible name that is itself localised.
- Announces the language it switches *to*, not the current one.
- Shows a visible focus indicator in both directions.

---

## Styling contract (D10)

Tailwind v4 with **logical properties only**:

| Use | Never use |
|---|---|
| `ms-*`, `me-*` | `ml-*`, `mr-*` |
| `ps-*`, `pe-*` | `pl-*`, `pr-*` |
| `text-start`, `text-end` | `text-left`, `text-right` |
| `start-*`, `end-*` | `left-*`, `right-*` |

**Rationale**: logical utilities follow the root `dir`, so one stylesheet serves both directions.
A single physical utility silently breaks Arabic layout while looking correct in English — which
is precisely the per-component RTL hack Constitution Principle I prohibits. Treat a physical
utility in review as a defect, not a style preference.

Exception: genuinely direction-neutral properties (`mt-*`, `mb-*`, `w-*`, `text-center`) are fine.

---

## Focus indicator contract

Every focusable element shows a visible indicator meeting WCAG 2.1 AA contrast. Do not remove
default outlines without supplying an equivalent. Verify in both directions, since offset-based
rings can clip differently under RTL.

---

## Routing contract (FR-013)

- `vue-router` in history mode.
- Phase 0 defines a minimal set: a home/landing route and a `404` catch-all.
- Route definitions live in `frontend/src/router/`, not inline in components.
- Route titles come from i18n keys, never hardcoded strings — so navigation is translatable from
  the first route onward.

---

## State contract (FR-014)

- Pinia, with stores under `frontend/src/stores/`.
- The auth store holds the access token **in memory only** and MUST NOT be persisted to
  `localStorage` or `sessionStorage` (D5).
- The locale store persists only the locale code to `localStorage` under `crm.locale`.

---

## Service layer contract (FR-015, FR-019, FR-021)

- All backend communication goes through `frontend/src/services/`. Components MUST NOT call
  `fetch` directly — this is enforced in review.
- One `http.ts` wrapper owns: attaching the `Authorization` header, single-flight token refresh on
  expiry, one retry of the original request, and error-envelope unwrapping.
- The backend base path comes from `VITE_API_BASE_URL` alone, so Phase 11's version segment is a
  one-line change (FR-021).
- Refresh calls send `credentials: 'include'` so the `httpOnly` cookie is transmitted.

---

## i18n contract (FR-010, FR-012)

- Message files at `frontend/src/locales/{ar,en}.json`, dot-namespaced keys.
- `ar.json` and `en.json` MUST contain **identical key sets**.
- No user-visible string may be hardcoded in a template or script (Constitution Principle I).
- Fallback locale is `en`, covering the corrupted/missing locale-file scenario in User Story 3.
