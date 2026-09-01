# Feature Specification: Phase 7 — Knowledge Base

**Feature Branch**: `008-phase-7-knowledge-base`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Implement a knowledge base: article/FAQ authoring with publish and archive states, categorization, full-text search available to both agents and customers, and suggested-article surfacing based on active ticket content."

**PLAN.md Reference**: Phase 7 — Knowledge Base

**Depends on**: Phase 1 — Security & Administration Foundations (who may author, publish, and archive
content, and the audit record of their doing so),
Phase 3 — Ticket Management (Core) (the ticket text a suggestion is computed from, and the taxonomy
a suggestion matches against)

## Overview

Phase 7 is the first thing this system **publishes** rather than sends.

Everything written so far has been addressed to somebody. A Phase 4 note is written to a colleague.
A Phase 5 reply is written to one customer, on the channel they used, in a conversation with a
history. Even a Phase 4 reply template — the closest thing the codebase has to reusable prose — is
inserted by an agent into a message they are about to send, which is why Phase 4 said plainly that
_"the template library is not a knowledge base"_.

An article has no addressee. It is written once, to nobody in particular, and read by people the
author will never meet — often at 02:00, by someone who cannot ask a follow-up. Four consequences
follow, and each one is a first for this codebase.

**Correctness stops being recoverable.** A reply that lands badly is clarified in the next message;
a conversation is a repair mechanism. An article is read alone. If it is wrong, out of date, or only
half-translated, nothing in the system catches it and nobody tells the author. That is why the
publish and archive states in PLAN.md's scope bullet are not administrative bookkeeping: they are
the only quality gate this content will ever have.

**Retrieval stops being lookup and becomes search.** Every query in Phases 2–6 answers _"find the
record I already know exists"_ — by reference, by name, by normalised phone number, by exact match on
an indexed column. This phase asks the opposite: _find something when I do not know what it is
called, in the words I happened to choose, possibly in the other language_. Relevance replaces
equality, and it has to work in Arabic — where word boundaries, prefixes, and short tokens all
behave differently from the Latin text every existing search was tuned against.

**The system acquires an opinion.** Phase 6 gave it a mandate to act on policy. Phase 7 gives it a
view about what a person probably needs: a suggested article is the system saying _"this might be
what you are looking for"_. Being wrong is cheap but not free — a panel that suggests badly two or
three times is a panel agents stop reading, and after that it cannot be fixed by improving the
suggestions.

**Content exists without a customer.** Every record in this system so far has belonged to a customer
or a ticket, which is what made its retention, visibility, and deletion rules obvious. An article
belongs to nobody. It has no owner in the data sense, no customer whose consent governs it, and no
conversation to be read in the context of — so its lifecycle has to be stated rather than inherited.

Phase 7 also inherits three commitments that earlier phases made **on its behalf**, and it must
honour rather than quietly reinterpret them:

- **Phase 4 Clarifications Q2** built the reply-template library with no outbound channel and said
  explicitly that it is not a knowledge base. The two must not be merged here: a template is text an
  agent sends, an article is a document a reader finds.
- **Phase 5's Out of Scope** assigned _"knowledge-base article suggestion or deflection before a
  conversation starts"_ to this phase. Deflection is therefore Phase 7's, not Phase 8's, and
  Clarifications Q1 builds the public surface it needs — deferring it would have left two
  consecutive phases each believing the other owned it.
- **Phase 6's automation catalog** was deliberately shaped so that a `suggest_article` action is one
  catalog entry plus one executor branch, rather than a change to the rule engine.

## Clarifications

### Session 2026-09-01

Three questions were raised during `/speckit-specify`. Each is a point where PLAN.md's Phase 7 scope
depends on a decision PLAN.md itself does not make, and where the readings differ enough to change
what gets built. All three are resolved; no `[NEEDS CLARIFICATION]` markers remain.

- **Q1 — Is the customer-facing half of this phase PUBLIC, or does it wait for Phase 8's login?**
  PLAN.md puts "full-text search (agent- and customer-facing)" in Phase 7, but customer
  authentication does not exist until Phase 8 — Phase 5 introduced only anonymous public surfaces.
  **Decision: a PUBLIC, UNAUTHENTICATED HELP CENTRE is delivered in this phase** — browse and search
  over published, customer-visible articles, and nothing else. The alternative reading leaves a
  scope bullet unmet and makes deflection impossible, and deflection is not optional extra credit
  here: Phase 5's Out of Scope explicitly assigned _"knowledge-base article suggestion or deflection
  before a conversation starts"_ to this phase. Deferring it would mean two consecutive phases each
  believing the other owns it. See FR-032 and FR-032a–FR-032e.
- **Q2 — What is an article filed under, and what is a "guide"?** PLAN.md's scope bullet reads
  "Categorization and guides" without defining either. **Decision: the knowledge base has ITS OWN
  category taxonomy, and a GUIDE IS AN ORDERED SERIES OF ARTICLES on one subject.** Reusing Phase 3's
  four ticket categories would make suggestion matching exact and free, and would make browsing
  nearly useless — four buckets is not a help centre, and the reader who cannot name what they want
  is exactly who browsing exists for. Giving "guide" the meaning of an ordered series is the reading
  that makes it a distinct thing rather than a synonym for "long article". See FR-011 and
  FR-011a–FR-011d.
- **Q3 — May an article be published in only one language?** Principle I is non-negotiable for the
  *interface*, and Phase 4 allowed a one-language template provided the language was identified
  (Phase 4 FR-070). **Decision: one language is enough to publish, and the article's language is
  always shown.** Requiring both would block publishing on translation, and the realistic outcome of
  that is fewer articles rather than more bilingual ones — help nobody gets while it waits to be
  perfect. FR-029 is what makes this survivable: a reader whose query matches nothing in their own
  language but matches content in the other is told so rather than shown a flat absence. See FR-005
  and FR-005a–FR-005c.

**Q1 has a consequence worth carrying forward.** This phase adds the fourth entry to the public
router Phase 5 deliberately kept in one file so that the whole unauthenticated attack surface is
visible at once. That file's comment is a standing instruction, not a description, and this phase is
the first test of whether it holds.

**Q2 has a consequence worth carrying forward.** Because the KB taxonomy is its own, suggestion
cannot match on category equality and needs a stated relationship instead (FR-040). Phase 12's
departments will meet the same question about whether a category tree is global.

**Q3 has a consequence worth carrying forward.** A published knowledge base will contain articles a
given reader cannot read. Phase 8's portal inherits that, and must not present a monolingual article
as though the reader's language were merely missing from the page.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — An Agent Finds the Answer Without Leaving the Ticket (Priority: P1)

An agent is part-way through a ticket about a card reader that keeps rebooting. Rather than asking a
colleague or guessing, they search the knowledge base from the ticket screen, find the article that
covers it, and answer the customer with the right steps.

**Why this priority**: it is the shortest path from "we have written this down" to "it saved somebody
time", and it needs nothing but articles and search. Every other story either feeds it or extends it.

**Independent Test**: publish two articles, search from a ticket for a term appearing in one of them,
and confirm the right article is found and readable without navigating away. Delivers value alone:
knowledge stops living in the heads of whoever has been here longest.

**Acceptance Scenarios**:

1. **Given** a published article containing "card reader", **When** an agent searches for "card
   reader", **Then** the article appears in the results with enough context to tell it apart from
   its neighbours.
2. **Given** an article that is a draft, **When** an agent searches for its exact title, **Then** it
   does not appear in search results.
3. **Given** an archived article, **When** an agent searches for its exact title, **Then** it does
   not appear alongside live results.
4. **Given** an article written in Arabic, **When** an agent searches in Arabic, **Then** it is
   found — the search is not usable in one language only.
5. **Given** a search that matches nothing, **When** the results are shown, **Then** the agent is
   told plainly that nothing matched rather than shown an empty area.

---

### User Story 2 — Somebody Writes an Article and Decides When It Goes Live (Priority: P1)

A supervisor writes up the card-reader fix. It sits as a draft while they check it with the
engineer who diagnosed it. When they are satisfied, they publish it. Six months later the hardware
changes and they archive it rather than delete it.

**Why this priority**: nothing can be found until something has been written, and the publish state
is the only quality gate this content will ever have. It is the other half of the MVP.

**Independent Test**: create a draft, confirm it is invisible to search, publish it, confirm it
appears, archive it, confirm it disappears — and that the archived article is still readable by its
author.

**Acceptance Scenarios**:

1. **Given** a user with authoring permission, **When** they create an article, **Then** it is saved
   as a draft and is not visible to anybody searching.
2. **Given** a draft, **When** it is published, **Then** it becomes findable, and who published it
   and when is recorded.
3. **Given** a published article, **When** it is archived, **Then** it stops appearing in search but
   is not destroyed, and can be restored.
4. **Given** a user without authoring permission, **When** they attempt to create, publish, or
   archive an article, **Then** the attempt is refused server-side, not merely hidden.
5. **Given** an article is edited after publication, **When** the change is saved, **Then** readers
   see the new version and the change is recorded in the audit log.

---

### User Story 3 — The Right Article Appears Before Anyone Goes Looking (Priority: P1)

An agent opens a ticket they have not read yet. Beside it, without being asked, are two or three
articles that match what the customer wrote. One of them is the answer.

**Why this priority**: this is PLAN.md's Definition of done — _"the system proactively suggests one on
a matching ticket"_ — and it is the difference between a knowledge base that gets used and one that
is written and forgotten. Phase 4 explicitly reserved this surface for this phase.

**Independent Test**: raise a ticket whose text matches a published article, open it, and confirm the
article is suggested without any search being performed.

**Acceptance Scenarios**:

1. **Given** a published article about card readers, **When** an agent opens a ticket whose subject
   or description mentions a card reader, **Then** that article is suggested on the ticket.
2. **Given** a ticket whose text matches nothing, **When** it is opened, **Then** the suggestion
   area says so plainly rather than showing an empty panel or an arbitrary article.
3. **Given** a suggested article, **When** the agent opens it, **Then** they can read it without
   losing their place on the ticket.
4. **Given** an article that is a draft or archived, **When** a ticket matching it is opened,
   **Then** it is never suggested.
5. **Given** a ticket, **When** suggestions are computed, **Then** they are ordered so the best match
   is first, and the ordering is the same for two agents opening the same ticket.

---

### User Story 4 — A Customer Finds the Answer Without Raising a Ticket (Priority: P2)

A customer with a question searches the help centre, finds the article, and does not raise a ticket
at all.

**Why this priority**: PLAN.md names customer-facing search in this phase's scope, and deflection —
which Phase 5 assigned here — is where a knowledge base pays for itself. It is P2 rather than P1
because the agent-facing half delivers value on its own, and because its shape depends on
Clarifications Q1.

**Independent Test**: as an unauthenticated visitor (or a Phase 8 portal user, per Q1), search for a
published article and read it, and confirm nothing that is not published is reachable.

**Acceptance Scenarios**:

1. **Given** a published article marked as visible to customers, **When** a customer searches for it,
   **Then** they can find and read it.
2. **Given** an article marked internal, **When** a customer searches for its exact title, **Then**
   it is not found and its existence is not disclosed.
3. **Given** a draft or archived article, **When** a customer searches for it, **Then** it is not
   found.
4. **Given** a customer reading an article, **When** they cannot resolve their problem, **Then**
   there is a way from the article to raising a ticket.
5. **Given** the customer-facing surface, **When** it is used repeatedly and rapidly, **Then** it is
   rate limited like every other public surface, and no request discloses anything about customers,
   tickets, or users.

---

### User Story 5 — Content Is Organised Well Enough to Browse (Priority: P2)

Somebody who does not know what to search for opens the knowledge base and works down from a
category to the article they need.

**Why this priority**: PLAN.md names categorisation and guides in its scope bullet. Search serves the
person who knows roughly what they want; browsing serves the person who does not, and a help centre
that only supports search fails the second group entirely.

**Independent Test**: file articles under categories, browse from the top, and confirm every
published article is reachable without searching.

**Acceptance Scenarios**:

1. **Given** articles filed under categories, **When** a reader browses a category, **Then** they see
   the published articles in it.
2. **Given** an article, **When** it is created, **Then** it must be filed somewhere — an article
   nobody can browse to is one only search can rescue.
3. **Given** a category containing no visible articles, **When** it is browsed, **Then** the reader
   is told rather than shown an empty page.
4. **Given** the category structure, **When** it is changed, **Then** existing articles remain
   reachable and none is orphaned.

---

### User Story 6 — Out-of-Date Content Is Found Before a Customer Finds It (Priority: P3)

A supervisor reviewing the knowledge base can see which articles are old, which are never read, and
which were most recently changed — so the ones that have quietly gone stale can be fixed.

**Why this priority**: a knowledge base decays silently, and the decay is invisible until a customer
is given wrong instructions. It is P3 because it improves content quality rather than enabling
anything, and because it is only useful once there is content to review.

**Independent Test**: publish several articles, view them, and confirm the management view reports
when each was last updated and how often each has been read.

**Acceptance Scenarios**:

1. **Given** published articles, **When** a supervisor opens the management view, **Then** they can
   see when each was last updated and by whom.
2. **Given** articles that have been read, **When** the management view is opened, **Then** a view
   count is shown per article.
3. **Given** a reader opening an article, **When** the view is recorded, **Then** nothing that
   identifies the reader is stored.

---

### User Story 7 — An Automation Rule Can Point at an Article (Priority: P3)

A supervisor adds a rule: when a ticket arrives on the billing category from the web form, attach the
billing FAQ to it.

**Why this priority**: Phase 6 explicitly shaped its action catalog so this is one entry plus one
branch, and recorded it as Phase 7's to add. It is P3 because it is an extension of machinery that
already exists rather than new capability.

**Independent Test**: add the article action to a rule, fire the rule, and confirm the article is
attached and the run recorded exactly as any other automation action.

**Acceptance Scenarios**:

1. **Given** an automation rule with an article action, **When** it fires on a matching ticket,
   **Then** the article is surfaced on that ticket and the run is recorded.
2. **Given** the rule action names an article that has since been archived or deleted, **When** the
   rule fires, **Then** it fails with a recorded reason rather than attaching nothing silently.

---

### Edge Cases

- **A published article is edited into a worse state.** There is no review step and no version
  history (see Assumptions) — the audit record of who changed what is the only recourse, and FR-024
  requires it.
- **An article is archived while it is being suggested** on an open ticket. The suggestion must
  disappear on the next read rather than linking to something no longer live (FR-042).
- **An article is archived while a customer is reading it.** They finish reading; the link simply
  stops being findable (FR-034).
- **Search terms in the wrong language for the article.** A customer searching English for content
  written in Arabic finds nothing, and must be told that rather than shown an empty page (FR-029).
- **Very short search terms**, which many Arabic words are. The search must not silently return
  nothing for a legitimate two-character word (FR-027).
- **A search term that is also a category name** — the reader probably wants the category, not the
  articles mentioning it in passing.
- **A ticket with almost no text** — a two-word subject and no description. Suggestion must degrade
  to "nothing to suggest" rather than to noise (FR-041).
- **A ticket in Arabic and articles in English**, or the reverse. Suggestion crosses the same
  language gap search does, and FR-043 says which way that falls.
- **An article filed in a category that is later removed.** No article may be orphaned (FR-015).
- **The knowledge base is empty**, which is its state on the day it ships. Every surface — search,
  browse, and the ticket suggestion panel — must read as "nothing here yet" rather than as broken.
- **A public reader hammering search** to enumerate content or exhaust the service (FR-036).

## Requirements _(mandatory)_

### Functional Requirements

#### Authoring and lifecycle

- **FR-001**: Users with the authoring permission MUST be able to create, edit, and read articles.
- **FR-002**: An article MUST have a title and a body, and MUST record who created it and when.
- **FR-003**: An article MUST have exactly one lifecycle state at a time: draft, published, or
  archived.
- **FR-004**: A newly created article MUST start as a draft, and a draft MUST NOT be reachable by any
  search or browse surface.
- **FR-005**: An article MUST record which language or languages its content exists in, and MUST be
  publishable with content in only one of them (Clarifications Q3).
- **FR-005a**: Wherever an article is listed or opened, the language it is written in MUST be
  identified, so a reader is never handed content in a language they did not ask for without being
  told — the rule Phase 4 established for one-language templates (Phase 4 FR-070).
- **FR-005b**: An article MUST be publishable with content in both languages, and where both exist
  the reader MUST be shown the one matching their active language.
- **FR-005c**: Adding the second language to an already-published article MUST NOT require
  unpublishing it.
- **FR-006**: Publishing MUST be a distinct, deliberate act from saving, and MUST record who
  published it and when.
- **FR-007**: Archiving MUST remove an article from every reader-facing surface WITHOUT destroying
  it, and an archived article MUST be restorable to published.
- **FR-008**: Article bodies MUST accept and correctly store non-Latin characters, including Arabic,
  and MUST preserve the author's paragraph structure.
- **FR-009**: Creating, editing, publishing, archiving, and restoring an article MUST be recorded in
  the audit log; article content is organisational speech and its changes are answerable.

#### Organisation

- **FR-010**: Every article MUST be filed under at least one category; an article that can only be
  found by search is one nobody can browse to.
- **FR-011**: The knowledge base MUST have its OWN category taxonomy, manageable by a permitted user
  without a deployment, and separate from Phase 3's ticket categories (Clarifications Q2).
- **FR-011a**: A GUIDE MUST be an ordered series of articles on one subject, so a reader can work
  through a procedure in sequence rather than assembling it from search results.
- **FR-011b**: An article MUST be able to appear in a guide without leaving its category, and MUST be
  able to appear in more than one guide.
- **FR-011c**: A guide MUST show a reader where they are in the sequence and how to reach the next
  and previous step.
- **FR-011d**: A guide containing no reader-visible articles MUST NOT be offered to a reader.
- **FR-012**: Category names MUST be presented to readers in the active language from stored content
  rather than a hardcoded label.
- **FR-013**: A reader MUST be able to browse from a category to the published articles filed under
  it.
- **FR-014**: A category with no reader-visible articles MUST say so rather than render an empty
  page.
- **FR-015**: Removing or renaming a category MUST NOT orphan an article; every article MUST remain
  reachable by browsing afterwards.
- **FR-016**: The ordering of articles within a category MUST be deterministic, so two readers see
  the same list.

#### Search

- **FR-017**: Users MUST be able to search articles by words appearing in the title or body.
- **FR-018**: Search MUST return only articles in the published state.
- **FR-019**: Search results MUST be ordered by relevance, and the ordering MUST be deterministic for
  the same query and content.
- **FR-020**: Search MUST work in Arabic and in English, and MUST NOT be materially less usable in
  either.
- **FR-021**: A search result MUST carry enough context — at minimum a title and a fragment showing
  why it matched — for a reader to choose between results without opening each one.
- **FR-022**: Search MUST match against the article's own language content; a query in one language
  is not required to find content written only in the other.
- **FR-023**: Search MUST be case-insensitive and MUST ignore differences that readers do not intend
  as differences, consistent with how existing search in this system treats accents and case.
- **FR-024**: A search returning nothing MUST say so plainly and MUST suggest what to do next.
- **FR-025**: Search MUST return results quickly enough to be used mid-conversation with a customer
  (see SC-004).
- **FR-026**: Search MUST be bounded and paged; no query may return an unbounded result set.
- **FR-027**: Search MUST NOT silently discard legitimate short terms, which many Arabic words are.
- **FR-028**: Search MUST NOT disclose the existence of draft, archived, or internal-only articles
  through result counts, ordering, or error messages.
- **FR-029**: Where a reader's query matches nothing in their language but matches content in the
  other, the interface MUST make that discoverable rather than reporting a flat absence.

#### Reader access

- **FR-030**: Agents MUST be able to search and read published articles from within a ticket without
  navigating away from it.
- **FR-031**: An article MUST record whether it is visible to customers or internal to the
  organisation, and internal articles MUST NEVER be reachable by a customer-facing surface.
- **FR-032**: A PUBLIC, UNAUTHENTICATED HELP CENTRE MUST be delivered in this phase, exposing
  published, customer-visible articles and nothing else (Clarifications Q1).
- **FR-032a**: Every public help-centre endpoint MUST be enumerated in the same single place Phase 5
  established for unauthenticated routes, so the whole public attack surface stays readable at once.
- **FR-032b**: The public surface MUST be READ-ONLY. It MUST accept no reader-authored content of any
  kind — no comments, no ratings, no corrections.
- **FR-032c**: The public surface MUST NOT reveal whether an article exists in a state it cannot
  show; a draft, an archived article, and an article that was never written MUST be indistinguishable
  to a public reader.
- **FR-032d**: DEFLECTION: where a customer is about to raise a ticket through a public surface,
  matching published articles MUST be offered before they do — the capability Phase 5's Out of Scope
  assigned to this phase.
- **FR-032e**: Deflection MUST NEVER block or delay raising a ticket. A customer who wants a person
  gets one; suggesting an article is an offer, not a gate.
- **FR-033**: A customer reading an article MUST have a route from it to raising a ticket, so a
  failed self-service attempt does not become a lost customer.
- **FR-034**: An article archived while being read MUST NOT break the reader's current view; it
  simply stops being findable.
- **FR-035**: No reader-facing surface MUST disclose anything about customers, tickets, users, or
  internal configuration.
- **FR-036**: Any unauthenticated reader surface MUST be rate limited independently of the other
  public surfaces, so that traffic to one cannot exhaust another's allowance.

#### Suggestion

- **FR-037**: The system MUST suggest relevant published articles on a ticket without the agent
  searching.
- **FR-038**: Suggestions MUST be computed from the ticket's own text — at minimum its subject and
  description.
- **FR-039**: Suggestions MUST be limited to a small number, ordered best-first, and deterministic
  for the same ticket and content.
- **FR-040**: Suggestions MUST prefer articles related to the ticket's classification, so a billing
  ticket is not answered with a technical article that happens to share a word. Because the
  knowledge base has its OWN taxonomy (Clarifications Q2), that relationship MUST be stated
  explicitly rather than inferred from category equality — the cost of a taxonomy worth browsing.
- **FR-041**: A ticket whose text supports no confident suggestion MUST produce NO suggestions and
  say so, rather than filling the panel with weak matches.
- **FR-042**: A suggested article that is no longer published MUST stop being suggested at the next
  read.
- **FR-043**: Suggestion MUST work for tickets written in Arabic as well as English.
- **FR-044**: Opening a suggested article MUST NOT lose the agent's place on the ticket.
- **FR-045**: Suggestions MUST NOT be computed in a way that delays the ticket screen loading.
- **FR-046**: An automation rule MUST be able to surface a named article on a ticket, through Phase
  6's existing catalog and run record rather than a parallel mechanism.
- **FR-047**: An automation action naming an article that is no longer available MUST fail with a
  recorded reason rather than doing nothing silently.

#### Stewardship

- **FR-048**: Users with the authoring permission MUST be able to see, for each article, when it was
  last updated and by whom.
- **FR-049**: The system MUST count how many times each article has been read.
- **FR-050**: Read counting MUST NOT record anything identifying the reader.
- **FR-051**: A management view MUST make it possible to find articles that are stale, unread, or
  recently changed.

#### Permissions, audit, and interface

- **FR-052**: Authoring, publishing, archiving, and category management MUST be gated by permissions
  enforced server-side, and MUST appear in the roles screen through the existing permission catalog.
- **FR-053**: Reading published articles MUST NOT require a permission an ordinary agent lacks.
- **FR-054**: Every new screen MUST render correctly in Arabic (RTL) and English (LTR), with all
  interface text from locale files, and MUST meet the project's accessibility standard for keyboard
  navigation, labelling, contrast, and announced validation errors.
- **FR-055**: Article content MUST be displayed in the direction of the language it is written in,
  independently of the interface language, so an Arabic article inside an English interface still
  reads correctly.
- **FR-056**: An article's lifecycle state MUST be distinguishable without relying on colour alone.
- **FR-057**: The knowledge base MUST read as "nothing here yet" rather than as broken when it is
  empty, on every surface.

### PLAN.md Traceability

PLAN.md **Scope** bullets for Phase 7 map as follows:

| PLAN.md scope bullet                                | Requirements  | Verified by                            |
| --------------------------------------------------- | ------------- | -------------------------------------- |
| FAQ / article CRUD with publish/archive states       | FR-001–FR-009 | User Story 2, SC-002, SC-003           |
| Categorization and guides                            | FR-010–FR-016 | User Story 5, SC-007, SC-014           |
| Full-text search (agent- and customer-facing)        | FR-017–FR-036 | User Story 1, User Story 4, SC-001, SC-004, SC-005 |
| Suggested-article surfacing based on ticket content  | FR-037–FR-047 | User Story 3, User Story 7, SC-006, SC-008 |

PLAN.md **Definition of done** — _"An agent or customer can find a relevant article by searching, and
the system proactively suggests one on a matching ticket"_ — maps as follows:

| Definition of done clause                   | Verified by                                       |
| ------------------------------------------- | ------------------------------------------------- |
| "An agent … can find a relevant article"    | FR-017–FR-030, User Story 1, SC-001               |
| "or customer"                               | FR-031–FR-036, User Story 4, SC-005               |
| "by searching"                              | FR-019–FR-029, SC-004                             |
| "proactively suggests one on a matching ticket" | FR-037–FR-045, User Story 3, SC-006            |

**Carried forward from earlier phases.** Phase 4 Clarifications Q2 stated that the reply-template
library is not a knowledge base; the two stay separate here (see Out of Scope). Phase 5's Out of
Scope assigned article suggestion and deflection before a conversation to this phase, which is why
Question 1 decides more than a screen. Phase 6 shaped its automation catalog so an article action is
an addition rather than a change, which FR-046 collects.

### Key Entities

- **Article**: A titled document with a body, one lifecycle state, a language or languages, a
  customer-visible or internal audience, an author, and a record of when it last changed. It belongs
  to no customer and no ticket — the first record in this system that belongs to nobody.
- **Category**: The knowledge base's own filing structure, separate from Phase 3's ticket
  categories, so a reader who cannot name what they want can still reach it.
- **Guide**: An ordered series of articles on one subject. Not a longer article and not a category —
  the thing a reader works THROUGH, in sequence, when the answer is a procedure rather than a fact.
- **Search Result**: Not a stored record — an article plus the reason it matched and its position in
  a relevance ordering, computed per query.
- **Suggestion**: Not a stored record — the small set of published articles the system believes match
  a ticket, computed from that ticket's own text and recomputed on each read.
- **Article View**: An anonymous count of readings, carrying nothing about who read it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An agent can find a relevant published article from within a ticket in under 30
  seconds, without leaving the ticket.
- **SC-002**: No draft or archived article is reachable through any search, browse, or suggestion
  surface — verified for every surface, not only the one it was written on.
- **SC-003**: An article's full lifecycle — draft, published, archived, restored — is completable by a
  permitted user without developer help, and each step is attributable in the audit log.
- **SC-004**: 95% of searches return results fast enough to be used while a customer is waiting.
- **SC-005**: A reader on the customer-facing surface can find and read a published customer-visible
  article, and cannot reach anything else.
- **SC-006**: For a ticket whose text plainly matches a published article, that article appears among
  the suggestions without the agent searching — and a ticket matching nothing produces no
  suggestions at all rather than weak ones.
- **SC-007**: Every published article is reachable by browsing from a category, not only by search.
- **SC-008**: Two agents opening the same ticket see the same suggestions in the same order.
- **SC-009**: Search and suggestion both work in Arabic: an article written in Arabic is findable by
  an Arabic query, and an Arabic ticket produces suggestions.
- **SC-010**: An article written in one language and displayed inside an interface set to the other
  renders in its own direction and remains readable.
- **SC-011**: Read counts exist per article and contain nothing identifying any reader.
- **SC-012**: Every new screen passes bilingual (Arabic RTL / English LTR) and accessibility checks
  before the phase is accepted.
- **SC-013**: With an empty knowledge base, every surface reads as "nothing here yet" and none
  appears broken.
- **SC-014**: A reader can work through a guide from its first step to its last without returning to
  search, and always knows where they are in the sequence.
- **SC-015**: A public reader cannot distinguish an article that is draft, archived, or absent — all
  three are the same answer.
- **SC-016**: An article published in one language only is never presented as though the other
  language were merely missing from the page: its language is stated wherever it appears.
- **SC-017**: A customer offered a deflection article can still raise a ticket in the same number of
  steps as if it had not been offered.

## Assumptions

Reasonable defaults chosen where PLAN.md did not specify. Each is a candidate for
`/speckit-clarify`.

- **Articles are plain prose with basic structure** — headings, paragraphs, and lists. Not a rich
  editor, not embedded media, not attachments. Attachments have a home on customers and tickets
  already; an article that needs a diagram is a candidate for a later phase.
- **There is no review or approval workflow.** Publishing is a permission, not a queue. PLAN.md names
  publish and archive states and no third party to satisfy, and a review step is a process decision
  the organisation has not asked for.
- **There is no version history.** An edit replaces the previous text, and the audit record of who
  changed it is the recourse. Restoring a previous body is not built speculatively.
- **Suggestion is computed from the ticket's own text by matching words**, not by a model. PLAN.md
  places AI in Phase 9; this phase must not pre-empt it, and a deterministic suggestion is one an
  agent can learn to trust or distrust on evidence.
- **Suggestions are recomputed on each read** rather than stored on the ticket. A stored suggestion
  goes stale the moment an article is archived.
- **Articles have no expiry date and no scheduled publishing.** Staleness is surfaced (FR-051) and
  acted on by a person.
- **Read counts are a simple total**, not a time series. Trends over time are reporting, which
  PLAN.md places in Phase 10.
- **Article feedback ("was this helpful?") is not collected here.** PLAN.md places satisfaction
  feedback in Phase 8, and collecting two kinds of rating in two phases would produce two
  mechanisms.
- **The knowledge base is global.** There are no per-department or per-brand knowledge bases;
  departments arrive in Phase 12 and will reopen whether the category tree is global.
- **Categories are a flat list, not a tree.** Nesting is not built speculatively; a help centre that
  needs three levels of hierarchy on its first day has a content problem rather than a software one.
- **Guides are ordered by their author**, not computed. There is no prerequisite graph and no
  branching path.
- **The public help centre has no accounts, no sessions, and no personalisation.** It is the same
  content for everybody, which is what keeps it a read-only surface with nothing to leak.
- **Articles are not linked to each other** — no "related articles", no cross-references beyond what
  an author writes in the body.
- **Test coverage follows the pattern Phases 1–6 established**: the generated permission matrix
  extends to the new module automatically, and bilingual search behaviour is asserted by test rather
  than by inspection.

## Out of Scope

Recorded so later phases do not assume these were delivered here:

- **Customer authentication, ticket submission, and history** (Phase 8). The help centre this phase
  delivers is anonymous and read-only; it knows nothing about who is reading and shows the same
  content to everybody.
- **Post-resolution satisfaction feedback, and article helpfulness ratings** (Phase 8).
- **AI-generated articles, AI-ranked suggestions, and semantic search** (Phase 9). Suggestion here is
  deterministic and word-based.
- **Knowledge-base reporting, trend analysis, and content performance dashboards** (Phase 10). This
  phase surfaces last-updated and a read count; interpreting them over time is Phase 10.
- **Per-department, per-brand, or per-language-region knowledge bases** (Phase 12).
- **Merging the reply-template library into the knowledge base** (Phase 4 Clarifications Q2). A
  template is text an agent sends; an article is a document a reader finds. They stay separate.
- **Rich text, embedded media, attachments on articles, and file downloads.**
- **Review or approval workflows, scheduled publishing, and article expiry.**
- **Version history and rollback.**
- **Article comments, ratings, or any reader-authored content.** A public surface that accepts
  reader-authored text is a moderation problem this phase does not take on.
- **Translation tooling.** Whether an article exists in both languages is Question 3; helping an
  author produce the second one is not in this phase.
