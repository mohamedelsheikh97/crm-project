# CRM-Support — Implementation Plan

This plan breaks the SRS (`Customer_Support_CRM_SRS.docx`) into sequential phases.
Each phase is a self-contained Spec Kit cycle:

```
/specify  → describe the phase's feature scope (use the "Specify prompt" below)
/plan     → generate the technical plan against the project constitution
/tasks    → break the plan into actionable tasks
/implement → build it with Claude
```

Phases are ordered by dependency — later phases assume earlier ones are functional.
Cross-cutting constitution principles (Arabic/English + RTL, accessibility, security,
Composition API / Pinia / layered Express structure) apply to **every** phase, not
just Phase 0 — they're not repeated in each phase's checklist below, but they still
gate `/plan` and code review throughout.

---

## Phase 0 — Project Foundation

**Goal:** A running skeleton — nothing user-facing yet, but the monorepo, database,
and auth scaffolding exist and boot.

**SRS reference:** Section 6 (Technical Architecture & Toolchain), FR-10.5 (authentication)

**Scope:**

- Monorepo scaffold: `/frontend` (Vue 3 + Vite + TS + Tailwind + Pinia) and `/backend`
  (Express + Sequelize + MySQL), shared env var conventions at root
- Database connection, base Sequelize config, first migration (empty baseline)
- Base Express app: layered folder structure (routes/controllers/services/models),
  error-handling middleware, request logging
- JWT-based authentication skeleton (login endpoint, token issuance/verification
  middleware) — no roles/permissions yet, just "logged in or not"
- Base Vue app shell: routing, Pinia store setup, i18n scaffolding (ar/en), RTL
  toggle at the root layout level
- CI: install + build + (optional) lint pipeline

**Specify prompt:**

> Set up the CRM-Support monorepo skeleton: a Vue 3 + Vite + TypeScript + Tailwind
>
> - Pinia frontend and a Node.js + Express + Sequelize + MySQL backend, with JWT
>   authentication scaffolding and Arabic/English i18n with RTL support wired into
>   the base layout. No business features yet — this is the bootable foundation
>   every later phase builds on.

**Dependencies:** None
**Definition of done:** Both apps run locally; a user can log in against a seeded
test account and receive a valid JWT; switching language flips layout direction.

---

## Phase 1 — Security & Administration Foundations

**Goal:** Real users, roles, and permissions — the access model every later
feature is built on top of.

**SRS reference:** FR-10.1–FR-10.5, NFR-2.1–NFR-2.5

**Scope:**

- User accounts with role-based access control (Agent, Supervisor, Administrator)
- Permission model: granular per-role, per-module permissions
- Audit log for security-relevant actions (logins, permission changes, exports, deletions)
- System configuration screens shell (categories, templates, channel settings —
  populated progressively in later phases)
- Password policy + account lockout after repeated failed logins
- (Optional per SRS priority) MFA support

**Specify prompt:**

> Implement user account management with role-based access control (Agent,
> Supervisor, Administrator), a granular per-module permission model, an audit
> log for security-relevant actions, password policy enforcement with account
> lockout, and an administration screen for managing users and roles.

**Dependencies:** Phase 0
**Definition of done:** An Administrator can create users, assign roles, and see
an audit trail; permission checks are enforced server-side, not just hidden in the UI.

---

## Phase 2 — Customer Management

**Goal:** A working customer database — the entity every other module attaches to.

**SRS reference:** FR-1.1–FR-1.6

**Scope:**

- Customer CRUD (create, view, edit, deactivate)
- Contact details (phone, email, address)
- Notes and file attachments on a customer profile
- Search/filter by name, phone, email, company
- Duplicate detection on matching phone/email at creation

**Specify prompt:**

> Implement customer profile management: CRUD operations, contact details,
> attached notes and files, search/filter by name/phone/email/company, and
> duplicate detection when a matching phone or email already exists.

**Dependencies:** Phase 1 (permissions gate who can view/edit customers)
**Definition of done:** An Agent can find, create, and update a customer record,
with duplicates flagged rather than silently created.

---

## Phase 3 — Ticket Management (Core)

**Goal:** The core support workflow — create, assign, track, and resolve tickets.

**SRS reference:** FR-2.1–FR-2.7

**Scope:**

- Manual ticket creation (channel-based creation comes in Phase 5)
- Category and priority fields
- Manual assignment to an agent
- Status lifecycle (New → Open → Pending → Escalated → Resolved → Closed)
- Manual escalation path
- Full change-history audit trail per ticket
- Duplicate merge / related-ticket linking

**Specify prompt:**

> Implement core ticket management: manual ticket creation with category and
> priority, manual agent assignment, a defined status lifecycle including
> escalation, a full audit history of ticket changes, and the ability to merge
> duplicate tickets or link related ones.

**Dependencies:** Phase 1 (agents/roles), Phase 2 (tickets belong to customers)
**Definition of done:** A ticket can be created, moved through its full lifecycle,
and its history is fully auditable.

---

## Phase 4 — Agent Dashboard

**Goal:** The day-to-day workspace agents actually live in.

**SRS reference:** FR-4.1–FR-4.6

**Scope:**

- Assigned-ticket list, sortable/filterable by status, priority, due date
- Customer context panel alongside the active ticket
- Tasks and reminders linked to tickets/customers
- Quick-reply template library
- Internal notes + @mentions (hidden from customer)
- Real-time notifications (new assignment, mention, SLA warning)

**Specify prompt:**

> Build the agent dashboard: a filterable/sortable assigned-ticket list, a
> customer context panel, tasks and reminders, quick-reply templates, internal
> notes with @mentions, and real-time notifications for assignments, mentions,
> and SLA warnings.

**Dependencies:** Phase 3 (tickets must exist to work from)
**Definition of done:** An agent can triage their whole queue from one screen
without navigating away, and gets real-time pings for anything urgent.

---

## Phase 5 — Communication Channels

**Goal:** Omnichannel intake — tickets stop being manually created and start
arriving from real customer channels.

**SRS reference:** FR-3.1–FR-3.6

**Scope:**

- Email intake (SMTP/IMAP) → auto-converts to tickets
- WhatsApp Business API integration
- Embeddable live chat widget
- SMS send/receive
- Configurable web forms → tickets
- Unified per-customer conversation timeline across all channels

**Specify prompt:**

> Implement omnichannel ticket intake: email-to-ticket conversion, WhatsApp
> Business API messaging, an embeddable live chat widget, SMS send/receive,
> configurable web-to-ticket forms, and a unified conversation timeline per
> customer across all channels.

**Dependencies:** Phase 3 (tickets), Phase 4 (agents need somewhere to see incoming messages)
**Definition of done:** A message from any channel becomes a ticket automatically
and shows up correctly in the agent dashboard and the customer's timeline.

---

## Phase 6 — SLA & Automation

**Goal:** Service-level enforcement and rule-based workload automation.

**SRS reference:** FR-5.1–FR-5.5

**Scope:**

- SLA policy configuration (response/resolution targets per priority/category)
- Automatic ticket assignment (round-robin / load-based / skill-based)
- Automatic escalation on SLA breach or near-breach
- Automated alerts (in-app, email, SMS)
- Trigger-condition-action custom automation rule builder

**Specify prompt:**

> Implement SLA policy management with configurable response/resolution
> targets, automatic ticket assignment rules, automatic SLA-breach escalation,
> multi-channel automated alerts, and a trigger-condition-action rule builder
> for custom automation.

**Dependencies:** Phase 3, Phase 4, Phase 5 (needs real ticket flow to automate against)
**Definition of done:** A ticket that breaches its SLA escalates and notifies
the right people without manual intervention.

---

## Phase 7 — Knowledge Base

**Goal:** A searchable help-content repository for agents and customers.

**SRS reference:** FR-6.1–FR-6.4

**Scope:**

- FAQ / article CRUD with publish/archive states
- Categorization and guides
- Full-text search (agent- and customer-facing)
- Suggested-article surfacing based on ticket content

**Specify prompt:**

> Implement a knowledge base: article/FAQ authoring with publish and archive
> states, categorization, full-text search available to both agents and
> customers, and suggested-article surfacing based on active ticket content.

**Dependencies:** Phase 1 (who can author content), Phase 3 (suggestion needs ticket content)
**Definition of done:** An agent or customer can find a relevant article by
searching, and the system proactively suggests one on a matching ticket.

---

## Phase 8 — Customer Portal

**Goal:** Customer-facing self-service surface.

**SRS reference:** FR-8.1–FR-8.5

**Scope:**

- Customer login and ticket submission
- Request tracking and full history view
- FAQ/knowledge base access
- Post-resolution satisfaction feedback

**Specify prompt:**

> Build the customer self-service portal: authenticated ticket submission,
> status tracking, full interaction history, knowledge base browsing, and
> post-resolution satisfaction feedback collection.

**Dependencies:** Phase 3 (tickets), Phase 7 (KB), Phase 1 (customer auth model)
**Definition of done:** A customer can log in, raise and track a ticket, browse
help content, and rate the resolution — entirely without agent involvement.

---

## Phase 9 — AI Features

**Goal:** AI-assisted acceleration layered onto an already-working ticket flow.

**SRS reference:** FR-7.1–FR-7.5

**Scope:**

- Ticket thread summarization
- Suggested-reply drafting for agents
- Automatic ticket categorization/tagging
- Similar-ticket solution suggestions
- AI chatbot on portal/chat channel, handing off to a human ticket when it can't resolve

**Specify prompt:**

> Add AI-assisted features on top of the existing ticket workflow: automatic
> thread summarization, suggested reply drafting, automatic categorization,
> similar-ticket solution suggestions, and a chatbot on the customer portal and
> chat channel that creates a ticket when it cannot resolve the issue itself.

**Dependencies:** Phase 3, Phase 5 (chat channel), Phase 7 (KB grounds suggestions)
**Definition of done:** An agent sees a usable AI-drafted summary/reply on a real
ticket, and the chatbot successfully escalates to a ticket when it's stuck.

---

## Phase 10 — Reports & Management

**Goal:** Operational visibility for supervisors and management.

**SRS reference:** FR-9.1–FR-9.6

**Scope:**

- Ticket volume/status reports (filterable by date, category, channel, agent)
- SLA performance reports
- Agent performance reports
- CSAT reports
- Real-time management dashboard with configurable KPI widgets
- Export to PDF/Excel/CSV

**Specify prompt:**

> Implement reporting and management dashboards: ticket volume/status reports,
> SLA performance, agent performance, CSAT reporting, a configurable real-time
> KPI dashboard, and export to PDF/Excel/CSV.

**Dependencies:** Phases 3–9 (needs real operational data to report on)
**Definition of done:** A manager can open one dashboard and see accurate,
real-time KPIs, and export any report.

---

## Phase 11 — Integrations

**Goal:** Opening the system up to the outside world.

**SRS reference:** FR-11.1–FR-11.4

**Scope:**

- Documented, versioned REST API for customer/ticket/reporting data
- ERP integration for customer/order sync
- Webhook notifications on key lifecycle events

**Specify prompt:**

> Expose a documented, versioned REST API covering customer, ticket, and
> reporting data, add ERP synchronization for customer/order data, and
> implement webhook notifications for ticket and customer lifecycle events.

**Dependencies:** Phases 1–10 (there must be real data/events to expose)
**Definition of done:** An external system can pull data through the API and
receive a webhook when a ticket is created or resolved.

---

## Phase 12 — Multi-Tenancy & Platform Polish

**Goal:** Organization-level platform capabilities beyond a single team.

**SRS reference:** FR-12.2–FR-12.5 (FR-12.1, bilingual/RTL, is enforced from Phase 0 onward, not deferred here)

**Scope:**

- Multi-department support (separate queues, agents, configuration per department)
- Multi-branch/location support under one organizational account
- Custom branding (logo, color scheme) per organization/department

**Specify prompt:**

> Add multi-department and multi-branch support, with department-scoped ticket
> queues, agents, and configuration, and per-organization/department custom
> branding (logo and color scheme).

**Dependencies:** Phase 1 (roles/permissions must be department-aware from the start of this phase)
**Definition of done:** Two departments can operate independently in the same
instance without seeing each other's tickets, each with its own branding.

---

## Working Notes

- **Traceability:** Each phase heading maps 1:1 to a numbered module in the SRS
  (Section 3). Keep FR-x.y IDs in your Spec Kit specs so `/tasks` output stays
  traceable back to this document.
- **Constitution gate:** Every `/plan` run should be checked against
  `.specify/memory/constitution.md` before `/tasks` — particularly the
  accessibility/RTL and layered-architecture rules, since those are easy to
  violate quietly inside a single phase.
- **Re-sequencing:** Phases 9 (AI) and 10 (Reporting) can be reordered relative
  to each other if priorities shift — neither is a hard dependency of the other.
  Phases 0–3 and Phase 1's RBAC model should not be reordered; nearly everything
  else depends on them.
- **Open items from the SRS** (SLA targets, ERP system choice, AI provider,
  branding assets, code style conventions) should be resolved before the phase
  that needs them starts, not before Phase 0.
