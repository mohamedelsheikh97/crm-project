# CRM-Support

A bilingual (Arabic / English, RTL-first) customer support CRM. This repository is delivered in
phases; see [PLAN.md](./PLAN.md) for the full roadmap and
[.specify/memory/constitution.md](./.specify/memory/constitution.md) for the rules every phase
must follow.

**Current phase**: Phase 6 — SLA & Automation. The system acquires a mandate: tickets carry service
targets computed in working time against a configurable calendar, a missed target escalates and
notifies the right people with nobody watching, unassigned work routes itself to an eligible agent,
and a supervisor can add trigger-condition-action rules of their own from a screen.

This is the first phase in which something other than a person can change the record, so three
things are worth knowing before reading the code:

- **Automation calls services, never models.** Every rule action goes through the same function a
  person's request would, with a system actor, so the lifecycle and every existing guard apply to it
  without being re-implemented.
- **`tickets.due_at` is a seam, not a field.** Phase 4 reserved it; Phase 6 fills it from the SLA
  resolution target, and `due_source` says whether a policy or a person put the value there.
- **The escalation markers hold a target value, not a flag** — which is what makes "fire once,
  never re-fire, re-arm on a reopen" a single comparison.

## Prerequisites

| Requirement | Version                                      |
| ----------- | -------------------------------------------- |
| Node.js     | 22 LTS (verified on v22.17.1)                |
| npm         | 10+ (verified on 10.9.2)                     |
| Docker      | for the MySQL container (verified on 29.6.2) |

No local MySQL install is needed — the database runs in a container.

## Setup

```bash
cp .env.example .env
# Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to two DIFFERENT random strings
# of at least 32 characters. Startup fails if they match.

docker compose up -d      # wait for `docker compose ps` to report healthy
npm install               # single install covers both workspaces
npm run db:migrate
npm run db:seed
npm run dev
```

Backend on <http://localhost:3000>, frontend on <http://localhost:5173>.

Seeded development account: `admin@crm.local` / `ChangeMe123!`. It is an ordinary Administrator
holding no privilege outside the role system, and it is asked to choose a new password on first
sign-in.

### Account security policy

Four optional variables, all with defaults, so an existing `.env` keeps working. They are read
once at startup, so changing one needs a restart.

| Variable                   | Default | Controls                                |
| -------------------------- | ------- | --------------------------------------- |
| `PASSWORD_MIN_LENGTH`      | `12`    | Minimum password length (floored at 8)  |
| `PASSWORD_HISTORY_SIZE`    | `5`     | How many previous passwords are refused |
| `AUTH_MAX_FAILED_ATTEMPTS` | `5`     | Consecutive failures before lockout     |
| `AUTH_LOCKOUT_MINUTES`     | `15`    | How long a lockout lasts                |

A locked account returns the **same** response as a wrong password and an unknown account. That is
deliberate: saying "this account is locked" to an anonymous caller confirms the account exists.

## Scripts

Run all of these from the repository root.

| Script                                           | Does                                     |
| ------------------------------------------------ | ---------------------------------------- |
| `npm run dev`                                    | Both apps together                       |
| `npm run dev:backend` / `npm run dev:frontend`   | One app                                  |
| `npm run build`                                  | Type-checks and builds both workspaces   |
| `npm run lint` / `npm run lint:fix`              | ESLint across both workspaces            |
| `npm run format` / `npm run format:check`        | Prettier                                 |
| `npm run db:migrate` / `npm run db:migrate:undo` | Schema migrations                        |
| `npm run db:seed`                                | Seed data (idempotent, development only) |

### What seeding gives you

`npm run db:seed` creates the development administrator, the permission grants, and — from Phase 6 —
a working configuration you can raise a ticket against immediately:

- **One business calendar**: Sunday–Thursday, 09:00–17:00, `Africa/Cairo`. **This is an assumption,
  not a discovered fact**, and it is the first thing a real installation should change: every SLA
  target is measured against it, so a wrong calendar makes every target wrong by the same amount,
  silently.
- **Four SLA policies**, one per priority — urgent 1h/4h, high 4h/1d, normal 8h/3d, low 1d/5d, in
  **working** time. Editable like any other policy.
- **Alert subscriptions**: in-app everywhere, email to supervisors on a breach, SMS nowhere. A fresh
  installation should alert without shouting.
- **Automatic assignment switched OFF.** It changes who does the work, so it is turned on
  deliberately rather than by a seeder having run.

Three environment knobs tune the behaviour and are not exposed on any screen — everything else about
SLA and automation is a database row an administrator edits at runtime:

| Variable                           | Default | Does                                               |
| ---------------------------------- | ------- | -------------------------------------------------- |
| `SLA_WARNING_LEAD_MINUTES`         | 60      | How far ahead of a target the at-risk alert fires  |
| `AUTOMATION_MAX_DEPTH`             | 3       | How far a rule cascade may recurse before stopping |
| `ALERT_MAX_PER_RECIPIENT_PER_HOUR` | 20      | Outbound alert ceiling per person                  |

Note that the seeded `urgent` policy promises a 60-minute first response against a 60-minute warning
lead, so **every urgent ticket starts "at risk"**. That is what a configurable lead means rather than
a bug, but it is worth deciding on: lower the lead, or lengthen the target.

## Layout

```text
.
├── .env                 # ONE env file, at the root, for both workspaces (git-ignored)
├── docker-compose.yml   # MySQL 8.4
├── backend/             # Express + Sequelize + TypeScript (ESM)
└── frontend/            # Vue 3 + Vite + Pinia + vue-router + vue-i18n + Tailwind v4
```

## Where do I add…

**A backend endpoint?** Four files, in this order — the layering is not optional
(Constitution Principle III):

1. `backend/src/services/<name>.service.ts` — the business logic. **This is the only layer
   allowed to import from `backend/src/models/`.**
2. `backend/src/controllers/<name>.controller.ts` — HTTP in/out only. Reads the request, calls the
   service, shapes the response. No model access, no business rules.
3. `backend/src/routes/<name>.routes.ts` — an Express `Router` that delegates. No logic.
4. Register that router in `backend/src/routes/index.ts`, which is mounted at `/api`.

Throw the factories from `backend/src/errors/app-error.ts` rather than building responses by hand;
`middleware/error-handler.ts` turns them into the shared `{ error: { code, message, details } }`
envelope. Stack traces never appear in a response body.

**A frontend page?**

1. `frontend/src/views/<Name>View.vue` — `<script setup lang="ts">`, every user-visible string a
   `t('key')` call.
2. Add both keys to `frontend/src/locales/en.json` **and** `frontend/src/locales/ar.json`. The two
   files must always hold identical key sets.
3. Register the route in `frontend/src/router/index.ts` with an i18n key in `meta.titleKey` — never
   a literal title.

**A backend call from the frontend?** Add a function to `frontend/src/services/`. Components,
views, and layouts must never call `fetch` directly. `services/http.ts` already handles the
`Authorization` header, single-flight token refresh, one retry, and error unwrapping.

**A new environment variable?** Add it to `.env.example`, then to the zod schema in
`backend/src/config/env.ts`. That schema is the only place `process.env` is read.

**Something the system should do on its own?** Add a sweep to
`backend/src/lib/scheduler.ts`, and write it so that **missing a tick is harmless** — a state
comparison, never a "since last run" ledger. All three existing sweeps follow that rule, which is
why a target that expired while the process was down is still found on the next tick. There is one
timer and no job queue.

**An automation trigger, condition, or action?** One entry in
`backend/src/automation/catalog.ts`, and one branch in the executor if it is an action. The
catalog is read by the validator, the builder screen, and the executor, so a rule can never name
something the system cannot do — that closure is what makes it safe to let a rule fire on a
stranger's email. Do not add a free-text expression, a webhook, or a raw message body.

### SLA and automation — what not to break

- **`tickets.due_at` is the seam.** The SLA resolution target writes it; `due_source` says whether
  a policy or a person did. Everything downstream (the queue sort, the overdue filter, the
  approaching-due warning) reads `due_at` and must never assume a human set it.
- **The escalation markers hold a target VALUE, not a flag.** `resolution_escalated_for =
resolution_target_at` is what makes "fire once, do not re-fire after a manual de-escalation,
  re-arm on a reopen" one comparison instead of three code paths. A boolean cannot tell a re-save
  from a reschedule.
- **Automation calls services, never models.** Every rule action goes through the same function a
  person's request would, with a system actor, so the lifecycle, the assignee eligibility test, and
  opt-out all apply to it for free. Writing a model directly creates a second enforcement path.
- **Working time is not wall-clock time.** `lib/business-hours.ts` is the only place that knows the
  difference. Comparing two timestamps to measure "how much of the target is left" is wrong across
  any night or weekend.

### Authorization — read this before adding a protected endpoint

A new protected route needs **three** things, not one:

1. A permission key in the catalog at `backend/src/auth/permissions.ts`.
2. `requirePermission(key)` applied to the route.
3. A grant decision — which roles get it — in the seeder at
   `backend/src/db/seeders/20260826000007-role-permissions.cjs`.

**Miss any of them and the matrix test fails the build.** That is the feature, not an obstacle:
`backend/tests/authorization.matrix.test.ts` is generated from the catalog and additionally
asserts that every route under the admin router carries a permission, and that every catalog key
is actually enforced somewhere. A permission nothing checks is a lie, and a route nothing guards
is a hole — the suite refuses both.

Two rules that are easy to get wrong:

- **Never decide a permission outside `backend/src/services/authorization.service.ts`.** The
  middleware translates its answer into a response; it computes nothing.
- **Never put role or permission claims in the access token.** Authorization is read from the
  database on every request, which is what makes a deactivation or a permission change take effect
  immediately rather than whenever the token happens to expire.

### Customers

Customer routes sit at **`/api/customers`**, not under `/api/admin`. They are everyday Agent work
rather than administration, and putting them under the admin prefix would imply a permission
boundary that does not exist.

Two rules that are easy to get wrong:

- **Phone normalisation happens in exactly one place** — `backend/src/lib/phone.ts`. Contact
  writes, search, and duplicate detection all call it. A second implementation is how duplicate
  detection silently stops working, and its failure mode is a MISSED duplicate: nothing surfaces at
  the time, and the customer's history ends up split across two records.
- **Never display a normalised phone number.** Users see `value_raw`, exactly as they typed it.
  Normalisation is for matching only; showing `+201001234567` where the record says
  `+20 100 123 4567` reads as a bug.

Customers are **deactivated, never deleted**, so any later phase may treat a customer reference as
permanent.

### Attachments

Uploaded files live on disk under `ATTACHMENT_STORAGE_PATH` and are **never served statically**.
Every download streams through an authenticated, permission-checked endpoint — serving the
directory would make a file reachable by anyone who obtains its address, which is the same defect
as not checking permission at all.

Three further rules, each closing a specific hole:

- The stored filename is **generated**. A user's filename is attacker-controlled input, and
  `../..` inside one is how it becomes a path.
- The type is **sniffed from content**, never the extension or the client's `Content-Type`.
- The file is written **before** the row commits. An orphan file is harmless and sweepable; a
  committed row pointing at a file that was never written is a broken download.

Files are **not** virus-scanned in this phase — a deliberate deferral (Phase 2 Clarifications Q3)
that must be revisited before Phase 8, whose customer portal would let files arrive from outside
the organisation.

### Audit logging

Every security-relevant action is recorded. For a **state change**, pass the transaction:
`auditService.record(entry, transaction)` — the audit insert shares the transaction of the change
it records, so an unrecorded change cannot exist. For an **authentication event**, use
`recordAuthEvent(entry)`, which never throws: a failed sign-in cannot be un-failed, so a failed
audit write is logged loudly rather than rolling anything back.

No audit field may contain a credential. The writer strips a deny-list from every JSON column, so
a careless `metadata` payload cannot leak one.

## Styling and RTL

Tailwind v4 with **logical utilities only** — `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`,
`text-end`, `start-*`, `end-*`. Never `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`,
`left-*`, `right-*`. Symmetric utilities (`mx-*`, `px-*`, `mt-*`, `text-center`) are fine.
A single physical utility silently breaks Arabic layout while looking correct in English; review
treats it as a defect, not a style preference.

## Validating a change

`npm test` runs the suite across both workspaces. Backend tests drive the real Express app through
supertest against a dedicated `crm_support_test` schema, so a run can never touch development data.

CI runs `npm ci`, lint, test, and build on every push.

Manual validation procedures live with each phase:
[Phase 0](./specs/001-phase-0-foundation/quickstart.md) ·
[Phase 1](./specs/002-phase-1-security-administration/quickstart.md).
