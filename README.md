# CRM-Support

A bilingual (Arabic / English, RTL-first) customer support CRM. This repository is delivered in
phases; see [PLAN.md](./PLAN.md) for the full roadmap and
[.specify/memory/constitution.md](./.specify/memory/constitution.md) for the rules every phase
must follow.

**Current phase**: Phase 0 — Project Foundation. The application shell, authentication, and the
build/CI toolchain exist. Business screens start in Phase 1.

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

Seeded development account: `admin@crm.local` / `ChangeMe123!`.

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

## Styling and RTL

Tailwind v4 with **logical utilities only** — `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`,
`text-end`, `start-*`, `end-*`. Never `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`,
`left-*`, `right-*`. Symmetric utilities (`mx-*`, `px-*`, `mt-*`, `text-center`) are fine.
A single physical utility silently breaks Arabic layout while looking correct in English; review
treats it as a defect, not a style preference.

## Validating a change

There is no automated test suite in Phase 0 — this is a recorded decision, and a test framework
arrives in Phase 1. Validation is the manual V1–V13 procedure in
[specs/001-phase-0-foundation/quickstart.md](./specs/001-phase-0-foundation/quickstart.md).
CI runs `npm ci`, `npm run lint`, and `npm run build` on every push.
