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
# Set all FOUR JWT secrets to DIFFERENT random strings of at least 32 characters:
#   JWT_ACCESS_SECRET, JWT_REFRESH_SECRET  (staff)
#   PORTAL_JWT_ACCESS_SECRET, PORTAL_JWT_REFRESH_SECRET  (customer portal)
# Startup fails if any two of them match, naming the pair.

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

### The customer portal (Phase 8)

The portal is a **second identity realm**: a customer signs in with a token this application's staff
middleware refuses, and vice versa. That separation is cryptographic rather than conventional, which
is why two of these four variables are **required** and the application refuses to start without
them.

| Variable                    | Required | Default | Controls                                          |
| --------------------------- | -------- | ------- | ------------------------------------------------- |
| `PORTAL_JWT_ACCESS_SECRET`  | **yes**  | —       | Signs portal access tokens (≥32 chars)            |
| `PORTAL_JWT_REFRESH_SECRET` | **yes**  | —       | Signs portal refresh tokens (≥32 chars)           |
| `PORTAL_INVITE_TTL_HOURS`   | no       | `168`   | How long a portal invitation stays usable         |
| `PORTAL_RATE_PER_MINUTE`    | no       | `20`    | Base allowance for the portal's rate-limit scopes |

**All four JWT secrets must differ from each other**, and startup fails naming the pair that
collided. That refusal is the point rather than a nuisance: the staff middleware resolves a token's
subject against `users`, so a customer token signed with the staff secret would come back as a real
staff account with a real role. Sharing a secret is the one misconfiguration in this area that works
perfectly until somebody notices they can act as a member of staff.

**Access is invite-only.** There is no registration route, and no customer can reach the portal until
somebody holding `portal:manage` invites an email contact on their record — from the customer's
profile screen. `portal:manage` is seeded to Administrator and Supervisor, not to Agent.

**A newly invited customer often sees nothing at first, and that is correct.** The portal shows a
request only to the contact recorded as having raised it, and tickets created before this phase have
no such record. The migration associates every one it can decide without guessing; the rest are
associated by hand from the ticket screen ("Raised by"). An empty request list is a normal first
experience, not a fault.

**The portal accepts no file uploads.** Customers send files by replying to a request by email.
Lifting that needs a virus-scanning step first — see Phase 8's Out of Scope.

### AI features (Phase 9)

AI assistance is **optional and off by default**. With `AI_ENABLED=false` — the shipped default —
every surface below is absent and the product behaves exactly as it did at the end of Phase 8. That
is asserted by a test, not assumed.

**Processing happens in two places, and the split is not configurable.** Staff-facing features
(summaries, suggested replies, similar tickets) may send ticket content to an external AI provider.
The customer-facing assistant may **not**: it runs only on infrastructure this organisation
controls, and there is no fallback from one to the other in either direction. Which processor serves
which feature is decided by which module a service imports, enforced by lint, by a test that reads
the import graph, and by a runtime assertion — because a boundary that lived in a settings value
would be one careless edit away from sending customer chat to a third party, with nothing failing.
Changing it is a constitution amendment, not a deployment decision.

| Variable                       | Required | Default | Controls                                        |
| ------------------------------ | -------- | ------- | ----------------------------------------------- |
| `AI_ENABLED`                   | no       | `false` | The master switch. Off means Phase 8.           |
| `AI_EXTERNAL_API_KEY`          | if staff features on | — | Credentials for the external provider |
| `AI_LOCAL_BASE_URL`            | if assistant on | — | The controlled-infrastructure processor  |
| `AI_SUMMARY_ENABLED`           | no       | `false` | Initial state of ticket summaries               |
| `AI_DRAFT_ENABLED`             | no       | `false` | Initial state of suggested replies              |
| `AI_CLASSIFY_ENABLED`          | no       | `false` | Initial state of category suggestions           |
| `AI_SIMILAR_ENABLED`           | no       | `false` | Initial state of similar tickets (no model call)|
| `AI_ASSISTANT_ENABLED`         | no       | `false` | Initial state of the customer assistant         |
| `AI_CEILING_*`                 | no       | 500-2000| Daily invocations per feature                   |
| `AI_ASSISTANT_LANGS`           | no       | `en`    | Languages the assistant answers in              |
| `AI_ASSISTANT_GROUNDING_FLOOR` | no       | `0.35`  | How well an article must match before it answers|

The `*_ENABLED` flags and the ceilings seed a database row on first use; after that **Admin → AI
features** owns them, so an administrator can switch a surface off without a deploy and the change
is audited. `AI_ENABLED` stays in the environment: it is the "is this phase deployed at all"
switch, and no database row can override it.

**The application refuses to start** when a staff feature is enabled with no API key, when the
assistant is enabled with no local URL, or when `AI_LOCAL_BASE_URL` points anywhere that is not a
private address. The refusal is the point: an assistant quietly answering customers through a public
endpoint is the one misconfiguration here that works perfectly until somebody notices.

**Nothing generated reaches a customer without a person sending it**, except the assistant — which
answers only from published help articles, and declines rather than guessing when they do not cover
the question. A suggested reply is a draft in the composer with no existence until an agent sends
it. A category suggestion never writes the ticket; a human accepts it, and the acceptance is the
write.

**No prompt or completion text is stored.** The activity record under Admin → AI holds what ran, on
what, when, and what it cost — never the content, so the system keeps no second copy of customer
correspondence. Assistant conversations *are* retained, because they are what the organisation said
to a customer, on the same basis as any outbound message.

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

**An article, category, or guide?** Nothing in code — that content is authored at runtime and
stored per language on the row. If you are tempted to seed a taxonomy, do not: a knowledge base is
entirely the organisation's own, and inventing one guesses at their business. Every knowledge
surface is built to read as "nothing here yet" on a fresh database.

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

### The knowledge base — and why search is ours, not the database's

**This project owns its search because MySQL measurably cannot do it in Arabic.** That question
gets asked at every code review of `lib/text-normalise.ts`, so the measurement is recorded here.

Probed against this project's own MySQL 8.4.11, `utf8mb4_0900_ai_ci`, default settings:

| Query                                      | `FULLTEXT` result | Why it matters                              |
| ------------------------------------------ | ----------------- | ------------------------------------------- |
| a word, against a row holding it with `ال` | **0 matches**     | The Arabic definite article breaks matching |
| the same, in the other direction           | **0 matches**     | …and it fails both ways                     |
| a real two-letter Arabic word              | **0 matches**     | `innodb_ft_min_token_size` defaults to 3    |
| a word carrying harakat                    | matches           | The collation handles diacritics for free   |

The first two have **no configuration fix at all**. The third needs a global server variable, a
restart, and a full index rebuild — none of which a migration can express, and which a managed
MySQL may simply refuse. Those are two functional requirements failing on ordinary Arabic words,
so the matching is a normalised token table (`kb_article_terms`) plus a ranking function.

**The tokenizer runs at BOTH ends or it is worthless.** `normaliseForIndex` and `normaliseQuery`
are thin wrappers over one internal pipeline, and a test asserts they agree on every case.
Normalising indexed text by one set of rules and a query by another produces a word findable by
nobody — and the failure is invisible to any reviewer who does not read Arabic.

**Only published articles have index rows.** Drafting writes none, archiving deletes them,
publishing rebuilds them, all inside the writing transaction. That makes "a draft is not findable"
structural rather than checked: there is nothing to exclude, on any of the four reader surfaces, so
no query can forget to. If you find yourself adding `WHERE status = 'published'` to a search, the
index is wrong rather than the query.

**`backend/tests/search/text-normalise.test.ts` is the file to run first.** It holds the exact
cases the table above measures, and it is the only place the phase's central claim is observable.

#### What not to break

- **The public surface's visibility is a LITERAL, never a parameter.**
  `controllers/public/kb.controller.ts` passes `audience: 'customer'` and `status: 'published'` as
  constants. If somebody threads them through from the request "so the endpoint is reusable", that
  is one signature change away from serving internal content to the internet — and the diff would
  look like good engineering.
- **Draft, archived, internal, and non-existent are ONE answer.** All four return a byte-identical 404. A public reader must not be able to learn that an article exists but is not for them.
- **Suggestions are computed on read and never stored.** `kb_ticket_articles` holds only deliberate
  attachments — an agent pinning one, or a rule acting. A stored suggestion goes stale the moment an
  article is archived, and nothing notices.
- **An empty suggestion panel is a feature.** The score floor in `kb-suggestion.service.ts` is the
  one number in this phase whose wrong value makes the feature worthless while looking correct: too
  low and the panel is noise agents learn to ignore, too high and it is always empty — **and both
  pass every test in the suite.** It wants tuning against real tickets, not adjusting to make the
  panel look busier.
- **An article is archived, never deleted.** There is no delete route, method, or control, for the
  reason customers deactivate and tickets merge: a link already sent to a customer must not lead to
  a hole.
- **Article content is DATA, not locale keys.** It is authored at runtime and stored per language on
  the row, so it never enters the `ar.json` / `en.json` parity mechanism. The same goes for category
  and guide names — an administrator creating one cannot add a key to a locale file.
- **Article content carries its own `dir` and `lang`; the chrome does not.** A one-language article
  is legitimate, so an English article inside an Arabic help centre is normal. This is the one place
  in the project where direction is not purely a document-root concern, and the reason is that the
  direction is a property of the text rather than of the interface.

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

Manual validation procedures live with each phase, in that phase's `quickstart.md` under
`specs/` — from [Phase 0](./specs/001-phase-0-foundation/quickstart.md) through
[Phase 7](./specs/008-phase-7-knowledge-base/quickstart.md).

A few checks cannot be automated and are recorded in each phase's task list rather than quietly
dropped: reading Arabic long-form prose by eye, screen-reader navigation, greyscale, the public help
centre on a phone, and the two Phase 7 tuning passes — search quality against a real corpus, and
the suggestion score floor.
