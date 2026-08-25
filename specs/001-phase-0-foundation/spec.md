# Feature Specification: Phase 0 — Project Foundation

**Feature Branch**: `001-phase-0-foundation`

**Created**: 2026-08-25

**Status**: Draft

**PLAN.md Reference**: Phase 0 — Project Foundation

**Input**: User description: "Set up the CRM-Support monorepo skeleton: a Vue 3 + Vite +
TypeScript + Tailwind + Pinia frontend and a Node.js + Express + Sequelize + MySQL backend,
with JWT authentication scaffolding and Arabic/English i18n with RTL support wired into the
base layout. No business features yet — this is the bootable foundation every later phase
builds on."

## Clarifications

### Session 2026-08-25

- Q: How long should a session token stay valid before it expires, and should the backend also issue refresh tokens? → A: Short-lived access token (15 min) + refresh token (7 days)
- Q: Should Phase 0 set up an automated test framework and run tests in CI, or is the CI pipeline limited to install + build only? → A: Install + build only; no test framework in Phase 0, introduce it when first needed
- Q: Should backend API routes carry a version prefix such as `/api/v1/...` starting in Phase 0, or use unversioned paths until versioning is needed? → A: Unversioned `/api/...` now; introduce versioning in Phase 11
- Q: What should the baseline database migration create, given PLAN.md says "empty baseline" but FR-009 requires a seeded test user? → A: Minimal `users` table only (unique email, hashed password, timestamps); roles/permissions/lockout deferred to Phase 1
- Q: Should Phase 0 establish an accessibility baseline, or is accessibility deferred until real feature screens exist? → A: Minimal baseline only — correct root `lang`/`dir`, semantic landmarks, keyboard-accessible language toggle, visible focus indicators

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Local Environment Boots Successfully (Priority: P1)

A developer joins the project, clones the repository, and follows the documented setup steps.
Within minutes, both the frontend application and the backend server are running locally and
can communicate with the database — with no undocumented manual steps required.

**Why this priority**: Nothing else in the project can be developed or tested until both
applications run locally. This is the absolute prerequisite for every subsequent phase.

**Independent Test**: A fresh clone on a clean machine produces two running processes
(frontend dev server, backend server) with a database connection confirmed. No prior
knowledge of the codebase is required beyond the setup documentation.

**Acceptance Scenarios**:

1. **Given** a developer has the required runtime environment installed, **When** they follow
   the documented setup steps from a clean clone, **Then** both the frontend and backend
   start successfully and are reachable in a browser and via API requests.
2. **Given** the database is not running, **When** the backend starts, **Then** it exits
   with a clear error message identifying the database as the problem — it does not start
   silently in a broken state.
3. **Given** required environment variables are missing, **When** either application starts,
   **Then** it reports which variables are missing and refuses to start.

---

### User Story 2 — Developer Authenticates with a Seeded Test Account (Priority: P1)

A developer uses a pre-seeded test account to log in to the running backend, receives a
an access token and a refresh token, and can use the access token to reach a protected test
route. When wrong credentials
are provided, the system rejects the request with a clear error.

**Why this priority**: Authentication is the gateway to all protected functionality in every
future phase. The token-issuance and token-verification mechanisms must exist and be
verifiable before Phase 1 builds real users and roles on top of them.

**Independent Test**: Using only the seeded test account credentials, a developer can log
in and receive a token, then use that token to call a protected endpoint successfully. An
invalid token attempt returns an error.

**Acceptance Scenarios**:

1. **Given** the seeded test account exists, **When** correct credentials are submitted to
   the login endpoint, **Then** a 15-minute access token and a 7-day refresh token are returned.
2. **Given** a valid access token, **When** it is presented to a protected route, **Then**
   the route responds successfully.
3. **Given** an access token older than 15 minutes, **When** it is presented to a protected
   route, **Then** the route returns an unauthorised error — it does not process the request.
4. **Given** a malformed or tampered token, **When** it is presented to a protected route,
   **Then** the route returns an unauthorised error.
5. **Given** a valid refresh token, **When** it is sent to the refresh endpoint, **Then** a
   new 15-minute access token is returned.
6. **Given** a refresh token older than 7 days, **When** it is sent to the refresh endpoint,
   **Then** it is rejected and the user must log in again.
7. **Given** incorrect credentials, **When** a login is attempted, **Then** the response is
   a rejection with no information about which field was wrong (no enumeration).

---

### User Story 3 — User Switches Language and Layout Direction Changes (Priority: P1)

A user opens the application and switches the display language from English to Arabic. The
entire layout immediately mirrors to right-to-left, and all visible interface text switches
to Arabic. Switching back to English returns the layout to left-to-right.

**Why this priority**: The constitution mandates bilingual Arabic/English RTL support from
Phase 0. Retrofitting direction-aware layout after the UI is built across multiple phases
is far more expensive than establishing it here, in the skeleton.

**Independent Test**: On the base application shell (no business feature screens needed),
toggling language flips the layout direction and all text observable in the UI. This can be
verified before any business feature is built.

**Acceptance Scenarios**:

1. **Given** the application is displayed in English (LTR), **When** the user switches to
   Arabic, **Then** the layout direction becomes RTL and all interface text is in Arabic —
   without a full page reload.
2. **Given** the application is displayed in Arabic (RTL), **When** the user switches to
   English, **Then** the layout direction becomes LTR and all interface text is in English.
3. **Given** the selected language, **When** the page is refreshed, **Then** the language
   preference is retained and the correct layout direction is applied immediately on load.
4. **Given** a language file is unavailable or corrupted, **When** the application loads,
   **Then** it falls back to English rather than displaying broken or untranslated content.

---

### User Story 4 — CI Pipeline Validates Each Code Change (Priority: P2)

When a developer pushes code, an automated pipeline installs all dependencies and builds
both the frontend and backend. The pipeline reports clearly whether the build succeeded or
failed, giving the team immediate feedback on the health of the codebase.

**Why this priority**: CI is listed as a Phase 0 deliverable. It provides a safety net for
every subsequent phase and makes it safe to integrate contributions from multiple developers
working across phases simultaneously.

**Independent Test**: A deliberate syntax error pushed to the repository causes the pipeline
to report failure. A clean push produces a passing result. No test suite is involved.

**Acceptance Scenarios**:

1. **Given** a code push with no errors, **When** the CI pipeline runs, **Then** it installs
   dependencies and builds both applications, reporting success.
2. **Given** a code push containing a build error, **When** the CI pipeline runs, **Then**
   it fails and reports the error — it does not silently pass.
3. **Given** the pipeline has completed, **When** a developer checks the result, **Then**
   the outcome (pass/fail) and any error details are clearly visible.

---

### Edge Cases

- What happens when the database connection is lost while the backend is running?
  The backend logs the error and returns a service-unavailable response; it does not crash.
- What happens when an access token's signature has been tampered with?
  The backend rejects it as invalid — not merely as expired.
- What happens when the refresh endpoint is called with an access token instead of a refresh
  token (or vice versa)? The backend rejects it; the two token types are not interchangeable.
- What happens when both language files (ar and en) are missing?
  The application surfaces a clear error rather than rendering blank or broken UI.
- What happens when the CI pipeline step times out?
  The pipeline fails rather than hanging indefinitely, with a timeout-specific message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST be structured as a monorepo with clearly separated frontend
  and backend workspaces sharing a common environment configuration convention at the root.
- **FR-002**: The backend MUST expose a login endpoint that accepts user credentials and, on
  success, returns a signed access token valid for 15 minutes together with a refresh token
  valid for 7 days.
- **FR-003**: The backend MUST include request-verification middleware that validates access
  tokens on every protected route, rejecting invalid, missing, or expired tokens with an
  unauthorised response.
- **FR-004**: The backend MUST handle requests through a strictly layered structure: routing,
  request handling, business logic, and data access MUST each be separate, isolated concerns.
- **FR-005**: The backend MUST connect to the database at startup and MUST fail with a
  descriptive error if the connection cannot be established.
- **FR-006**: The backend MUST apply a baseline schema migration that creates a minimal
  `users` table containing a unique email identifier, a hashed password, and created/updated
  timestamps. No other tables are created in this phase.
- **FR-006a**: The email field MUST be enforced as unique at the database level, so duplicate
  accounts cannot be created regardless of application-layer checks.
- **FR-006b**: Roles, permissions, account-lockout counters, and audit-log tables MUST NOT be
  created in this phase; they belong to Phase 1's own migration.
- **FR-007**: The backend MUST include centralised error-handling middleware that intercepts
  unhandled errors and returns structured, consistent error responses — no raw stack traces
  in responses.
- **FR-008**: The backend MUST log every incoming request (method, path, status code, and
  response time) to support debugging from day one.
- **FR-009**: The database MUST be seeded with at least one test user account for local
  development and authentication verification.
- **FR-010**: The frontend MUST support at minimum two locales: Arabic (`ar`) and English
  (`en`), with all visible interface text externalised into locale files.
- **FR-011**: The frontend MUST apply right-to-left layout direction when the active locale
  is Arabic and left-to-right when it is English, with the switch taking effect without a
  full page reload.
- **FR-012**: The frontend MUST persist the user's language selection across page reloads.
- **FR-013**: The frontend MUST include a client-side routing structure prepared for feature
  screens to be added in later phases.
- **FR-014**: The frontend MUST include a centralised state management structure prepared for
  feature states to be added in later phases.
- **FR-015**: The frontend MUST include composable/service modules as the exclusive layer for
  backend communication; components MUST NOT make API calls directly.
- **FR-016**: The CI pipeline MUST install all dependencies, build both applications, and
  report a clear pass/fail result on each code push. Automated test execution is explicitly
  out of scope for this phase; the pipeline MUST NOT be blocked on a test stage that does
  not yet exist.
- **FR-017**: The application MUST validate the presence of required environment variables at
  startup and refuse to start if any are missing, reporting which are absent.
- **FR-018**: The backend MUST expose a token-refresh endpoint that accepts a valid refresh
  token and returns a new access token. Expired or invalid refresh tokens MUST be rejected,
  requiring the user to log in again.
- **FR-019**: The frontend service layer (per FR-015) MUST transparently obtain a new access
  token via the refresh endpoint when a request fails due to access-token expiry, and MUST
  retry the original request once. Individual components MUST NOT implement refresh logic.
- **FR-020**: Backend routes MUST be served under an unversioned `/api/` prefix in this phase
  (e.g., `/api/auth/login`). No version segment is introduced until Phase 11.
- **FR-021**: The frontend MUST resolve its backend base path from a single configuration
  value, so that introducing a version segment in Phase 11 requires changing one setting
  rather than editing individual call sites.
- **FR-022**: The root document element MUST carry a `lang` attribute matching the active
  locale (`ar` or `en`) and a `dir` attribute matching that locale's direction (`rtl` or
  `ltr`), both updating when the language is switched.
- **FR-023**: The base layout MUST use semantic landmark structure (header, main, navigation)
  so that assistive technology can navigate the shell every later screen inherits.
- **FR-024**: The language toggle MUST be operable by keyboard alone, and all focusable
  elements MUST display a visible focus indicator in both layout directions.

### PLAN.md Traceability

Every requirement above maps to a **Scope** bullet of PLAN.md "Phase 0 — Project Foundation":

| PLAN.md Phase 0 Scope bullet | Covered by |
|---|---|
| Monorepo scaffold (`/frontend`, `/backend`), shared env var conventions at root | FR-001, FR-017, FR-020, FR-021 |
| Database connection, base ORM config, first migration (empty baseline) † | FR-005, FR-006, FR-006a, FR-006b |
| Base backend app: layered folder structure, error-handling middleware, request logging | FR-004, FR-007, FR-008 |
| JWT auth skeleton (login endpoint, token issuance/verification middleware) | FR-002, FR-003, FR-009, FR-018, FR-019 |
| Base frontend shell: routing, state store setup, i18n (ar/en), root-level RTL toggle | FR-010–FR-015, FR-022–FR-024 |
| CI: install + build (+ optional lint) pipeline | FR-016 |

† **Deliberate deviation from PLAN.md wording.** PLAN.md describes the first migration as an
"empty baseline", but the same phase's Definition of done requires logging in against a seeded
test account — which is impossible without a table to hold it. Resolved in favour of a minimal
`users` table (FR-006). The spirit of "empty baseline" is preserved: no business-domain tables
are created in Phase 0.

PLAN.md **Definition of done** for Phase 0 maps as follows:

| Definition of done clause | Verified by |
|---|---|
| "Both apps run locally" | User Story 1, SC-001 |
| "a user can log in against a seeded test account and receive a valid JWT" | User Story 2, SC-002 |
| "switching language flips layout direction" | User Story 3, SC-003, SC-004 |

### Key Entities

- **User**: The account record used for authentication. Attributes in this phase: unique email
  (the login identifier), hashed password, created timestamp, updated timestamp. No role or
  permission attributes exist yet — those arrive in Phase 1.
- **Test User (Seed)**: A development-only `User` row with known credentials, inserted by the
  seed step so the authentication skeleton can be verified locally.
- **Access Token**: A signed credential issued at login, valid for 15 minutes. Contains enough
  information for the backend to identify the token's owner and verify its integrity on each
  request. Not stored server-side in this phase.
- **Refresh Token**: A signed credential issued alongside the access token, valid for 7 days.
  Its only purpose is to obtain a new access token from the refresh endpoint. Carries no
  authorisation on its own.
- **Application Configuration**: Environment-specific settings (database address, secret keys,
  API base URL) managed through a shared convention agreed upon at the monorepo root. No
  secrets are committed to version control.
- **Locale File**: A structured data file mapping translation keys to display strings for a
  given language. One file per supported language (ar, en). All user-visible text in the
  frontend references these files, not hardcoded strings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with the required runtime installed can bring both applications
  online from a clean repository clone in under 10 minutes by following the setup
  documentation — without needing to ask another team member for help.
- **SC-002**: 100% of the seven authentication acceptance scenarios in User Story 2 (correct
  credentials, wrong credentials, expired access token, tampered token, valid refresh,
  expired refresh) produce the correct response.
- **SC-002a**: A user actively using the application is never forced to re-authenticate before
  7 days of inactivity, despite the 15-minute access token lifetime.
- **SC-003**: Switching the application language visually changes the layout direction and
  all interface text within 1 second, with no full page reload, in both directions
  (EN → AR and AR → EN).
- **SC-004**: The language preference is retained correctly across 100% of page reload
  attempts in both directions.
- **SC-005**: The CI pipeline completes and reports a result within 5 minutes of a code push
  under normal conditions.
- **SC-006**: The project folder structure allows a developer who has not seen the codebase
  before to locate, without assistance, where to add a new backend endpoint and where to
  add a new frontend page.
- **SC-007**: The application shell can be operated end to end (switch language, navigate the
  base routes) using only a keyboard, in both Arabic and English.
- **SC-008**: The root element reports the correct `lang` and `dir` values for the active
  locale in 100% of language-switch and page-reload cases.

## Assumptions

- This phase delivers no business features; all deliverables are infrastructure that later
  phases build on.
- A developer running the project locally is assumed to have the required runtimes installed;
  installation of those runtimes is out of scope for this phase.
- A single seeded test user is sufficient for this phase; multi-user and role management
  are Phase 1 concerns.
- The language toggle is a minimal control on the base layout; the visual design of that
  control is deferred to later phases when a real design system is in place.
- The token mechanism in this phase handles only "authenticated or not"; role and
  permission encoding in tokens is a Phase 1 concern.
- Refresh tokens are not persisted or revocable server-side in this phase; server-side
  revocation (logout-everywhere, forced session termination) is a Phase 1 concern alongside
  the real user model.
- The CI pipeline provider is not mandated; any provider that satisfies SC-005 is acceptable.
- No automated test framework is set up in this phase. Phase 0's acceptance scenarios are
  verified manually. A test harness will be introduced in the first phase that needs it —
  most likely Phase 1, where server-side permission enforcement must be provably correct.
- Linting remains in scope per the constitution's Open Items (ESLint/Prettier established in
  the Phase 0 CI pipeline); the "install + build only" decision applies to test execution,
  not to lint.
- API versioning is deliberately deferred to Phase 11. This is an accepted, known cost: routes
  created in Phases 1–10 will need a version segment added when the public API is built.
  FR-021 (single configurable base path) is the mitigation that keeps that change small on the
  frontend side.
- MFA is not in scope for this phase; PLAN.md lists it as optional under Phase 1.
- RTL support at the root layout level satisfies the Phase 0 constitution requirement;
  per-component RTL refinement will occur as each component is built in subsequent phases.
- Accessibility in this phase is a structural baseline only (FR-022–FR-024). A full WCAG 2.1
  AA audit is deferred until real feature screens exist, and automated accessibility linting
  is not introduced — consistent with the decision to defer test tooling.
