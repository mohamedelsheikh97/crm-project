import { Op, type Transaction, type WhereOptions } from 'sequelize';

import { fetchLimit, keysetWhere, KEYSET_ORDER, type KeysetQuery } from '../api/paging.js';
import { sequelize } from '../config/database.js';
import * as outbox from '../integrations/outbox.js';
import {
  conflict,
  duplicateCustomer,
  notFound,
  staleRecord,
  validationError,
  type ErrorDetail,
} from '../errors/app-error.js';
import { normaliseContact, normalisePhone, type ContactKind } from '../lib/phone.js';
import { Customer, CustomerContact, DuplicateOverride } from '../models/index.js';

import * as auditService from './audit.service.js';
import * as duplicateService from './duplicate.service.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Actor {
  id: number;
  email: string;
}

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ContactInput {
  kind: ContactKind;
  value: string;
  isPrimary?: boolean;
}

export interface CustomerInput {
  displayName?: unknown;
  company?: unknown;
  address?: unknown;
  contacts?: unknown;
  acknowledgeDuplicates?: unknown;
  version?: unknown;
}

export interface ContactView {
  id: number;
  kind: ContactKind;
  /** What the user typed. Always what a human is shown (rule 3). */
  raw: string;
  /** Matching only — the interface uses it to explain a match, never to display. */
  normalised: string;
  isPrimary: boolean;
}

export interface CustomerSummary {
  id: number;
  displayName: string;
  company: string | null;
  isActive: boolean;
  /** Phase 5: created by the system from an unrecognised sender (FR-014b). */
  isProvisional: boolean;
  primaryPhone: { raw: string; normalised: string } | null;
  primaryEmail: string | null;
  contactCount: number;
  createdAt: Date;
  /**
   * Added in Phase 11 for keyset paging (FR-008).
   *
   * ADDITIVE — the screens ignore it, and adding a field to a response is not a
   * breaking change under the published interface's own versioning rules. It is
   * here rather than only in an API-specific shape so that `toSummary` stays the
   * single definition of what a customer summary is; a parallel mapper is
   * exactly the drift FR-010 forbids.
   */
  updatedAt: Date;
  version: number;
  matchedOn?: 'name' | 'company' | 'phone' | 'email';
}

export interface CustomerDetail extends CustomerSummary {
  address: string | null;
  contacts: ContactView[];
}

/**
 * The published interface's paging primitives.
 *
 * Imported here rather than reimplemented so the cursor encoding has one
 * definition — a client that received two different cursor formats from two
 * collections would have no way to know which it was holding.
 */
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

type WithContacts = Customer & { contacts?: CustomerContact[] };

function pickPrimary(contacts: CustomerContact[], kind: ContactKind): CustomerContact | null {
  const ofKind = contacts.filter((contact) => contact.kind === kind);
  return ofKind.find((contact) => contact.is_primary) ?? ofKind[0] ?? null;
}

function toSummary(customer: WithContacts): CustomerSummary {
  const contacts = customer.contacts ?? [];
  const phone = pickPrimary(contacts, 'phone');
  const email = pickPrimary(contacts, 'email');

  return {
    id: customer.id,
    displayName: customer.display_name,
    company: customer.company,
    isActive: customer.is_active,
    // Phase 5, FR-014b. TRUE means the system created this record from an
    // unrecognised sender and nobody has confirmed who it is. Surfaced
    // wherever customers are listed, so a provisional record is never mistaken
    // for one somebody onboarded.
    isProvisional: customer.is_provisional,
    primaryPhone: phone ? { raw: phone.value_raw, normalised: phone.value_normalised } : null,
    primaryEmail: email ? email.value_raw : null,
    contactCount: contacts.length,
    createdAt: customer.created_at,
    updatedAt: customer.updated_at,
    version: customer.version,
  };
}

function toDetail(customer: WithContacts): CustomerDetail {
  return {
    ...toSummary(customer),
    address: customer.address,
    contacts: (customer.contacts ?? []).map((contact) => ({
      id: contact.id,
      kind: contact.kind,
      raw: contact.value_raw,
      normalised: contact.value_normalised,
      isPrimary: contact.is_primary,
    })),
  };
}

/**
 * Keyset-paged listing for the published interface (Phase 11, FR-008, FR-009).
 *
 * EXTENDS RATHER THAN FORKS. It reuses `toSummary`, so there is one definition
 * of what a customer summary is — a second mapper would be the drift FR-010
 * exists to prevent, and it would diverge on the first field either surface
 * added.
 *
 * What it does NOT reuse is the offset paging: research D2 records why. Insert a
 * record while a client is paging and every later page shifts by one, so one
 * record is read twice and one is never read at all. Harmless for a screen;
 * for a client synchronising into another database it is a customer that
 * silently does not exist over there.
 *
 * Returns one row MORE than asked for, so `has_more` is derived rather than
 * counted — paging then costs no extra query, and a short page is never
 * mistaken for the last page.
 *
 * DEACTIVATED CUSTOMERS ARE INCLUDED, unlike the screen's default (FR-008 of
 * Phase 2). A synchronising client needs to learn that a customer was
 * deactivated; hiding the row would leave their copy active forever.
 */
export async function listKeyset(
  query: KeysetQuery,
): Promise<{ rows: Array<CustomerSummary & { id: number; updated_at: Date }>; hasMore: boolean }> {
  const found = await Customer.findAll({
    where: keysetWhere(query),
    include: [{ model: CustomerContact, as: 'contacts' }],
    order: [...KEYSET_ORDER] as [string, 'ASC'][],
    limit: fetchLimit(query),
  });

  const hasMore = found.length > query.limit;
  const rows = (hasMore ? found.slice(0, query.limit) : found).map((row) => ({
    ...toSummary(row as WithContacts),
    id: row.id,
    updated_at: row.updated_at,
  }));

  return { rows, hasMore };
}

/** Clamped rather than rejected — a default alone would not stop a caller asking for everything. */
export function clampPageSize(requested: unknown): number {
  const value = Number(requested);

  if (!Number.isFinite(value) || value < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.floor(value), MAX_PAGE_SIZE);
}

export interface ListOptions {
  search?: string;
  company?: string;
  isActive?: boolean | 'all';
  page?: unknown;
  pageSize?: unknown;
}

/**
 * Search and list (research.md D3).
 *
 * Split by field, matching what an agent actually holds during a call:
 * phone and email are EXACT lookups against the indexed normalised column and
 * stay fast regardless of table size; name and company use substring matching,
 * which is linear and is the known ceiling.
 */
export async function list(options: ListOptions = {}): Promise<Paged<CustomerSummary>> {
  const pageSize = clampPageSize(options.pageSize);
  const requestedPage = Number(options.page);
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;

  const where: WhereOptions = {};

  // Deactivated customers are excluded by default (FR-008).
  if (options.isActive !== 'all') {
    Object.assign(where, { is_active: options.isActive ?? true });
  }

  if (options.company) {
    Object.assign(where, { company: { [Op.like]: `%${options.company}%` } });
  }

  let contactMatchIds: number[] | null = null;

  if (options.search) {
    const term = options.search.trim();

    // The same term is tried as a phone and as an email, so the caller never
    // has to say which it is (FR-010).
    const asPhone = normalisePhone(term);
    const asEmail = normaliseContact('email', term);

    const contactMatches = await CustomerContact.findAll({
      where: {
        [Op.or]: [
          ...(asPhone ? [{ value_normalised: { [Op.like]: `%${asPhone}` } }] : []),
          { value_normalised: { [Op.like]: `${asEmail}%` } },
        ],
      },
      attributes: ['customer_id'],
    });

    contactMatchIds = [...new Set(contactMatches.map((row) => row.customer_id))];

    Object.assign(where, {
      [Op.or]: [
        { display_name: { [Op.like]: `%${term}%` } },
        { company: { [Op.like]: `%${term}%` } },
        ...(contactMatchIds.length > 0 ? [{ id: { [Op.in]: contactMatchIds } }] : []),
      ],
    });
  }

  const { rows, count } = await Customer.findAndCountAll({
    where,
    include: [{ model: CustomerContact, as: 'contacts' }],
    order: [['created_at', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  const matchedIds = new Set(contactMatchIds ?? []);
  const term = options.search?.trim().toLowerCase() ?? '';

  const items = rows.map((row) => {
    const summary = toSummary(row as WithContacts);

    // Tell the interface WHY this row is here — searching a number and getting
    // unexplained names is disorienting (contracts/customer-ui.md).
    if (term) {
      if (summary.displayName.toLowerCase().includes(term)) {
        summary.matchedOn = 'name';
      } else if (summary.company?.toLowerCase().includes(term)) {
        summary.matchedOn = 'company';
      } else if (matchedIds.has(summary.id)) {
        summary.matchedOn = term.includes('@') ? 'email' : 'phone';
      }
    }

    return summary;
  });

  // Exact contact matches rank above substring name matches.
  items.sort((a, b) => rank(a) - rank(b));

  return { items, page, pageSize, total: count };
}

function rank(summary: CustomerSummary): number {
  if (summary.matchedOn === 'phone' || summary.matchedOn === 'email') return 0;
  if (summary.matchedOn === 'name') return 1;
  return 2;
}

export async function getById(id: number): Promise<CustomerDetail> {
  const customer = await Customer.findByPk(id, {
    include: [{ model: CustomerContact, as: 'contacts' }],
  });

  if (!customer) {
    throw notFound();
  }

  return toDetail(customer as WithContacts);
}

/**
 * Validates and normalises the supplied contact list.
 *
 * At least one contact is required (FR-003) — a customer nobody can contact is
 * not usable.
 */
function parseContacts(raw: unknown, details: ErrorDetail[]): ContactInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    details.push({ field: 'contacts', message: 'customer.error.contactRequired' });
    return [];
  }

  const parsed: ContactInput[] = [];

  for (const entry of raw as ContactInput[]) {
    const kind = entry?.kind;
    const value = typeof entry?.value === 'string' ? entry.value.trim() : '';

    if (kind !== 'phone' && kind !== 'email') {
      details.push({ field: 'contacts', message: 'customer.error.contactKindInvalid' });
      continue;
    }

    if (value === '') {
      details.push({ field: 'contacts', message: 'customer.error.contactValueRequired' });
      continue;
    }

    if (kind === 'email' && !EMAIL_PATTERN.test(value)) {
      details.push({ field: 'contacts', message: 'customer.error.emailInvalid' });
      continue;
    }

    parsed.push({ kind, value, isPrimary: Boolean(entry.isPrimary) });
  }

  if (parsed.length === 0 && details.length === 0) {
    details.push({ field: 'contacts', message: 'customer.error.contactRequired' });
  }

  return parsed;
}

/** Exactly one primary per kind; the first of a kind is primary when none is marked. */
function assignPrimaries(contacts: ContactInput[]): ContactInput[] {
  for (const kind of ['phone', 'email'] as const) {
    const ofKind = contacts.filter((contact) => contact.kind === kind);
    if (ofKind.length === 0) continue;

    const marked = ofKind.filter((contact) => contact.isPrimary);
    const primary = marked[0] ?? ofKind[0];

    for (const contact of ofKind) {
      contact.isPrimary = contact === primary;
    }
  }

  return contacts;
}

async function writeContacts(
  customerId: number,
  contacts: ContactInput[],
  transaction: Transaction,
): Promise<void> {
  await CustomerContact.destroy({ where: { customer_id: customerId }, transaction });

  await CustomerContact.bulkCreate(
    contacts.map((contact) => ({
      customer_id: customerId,
      kind: contact.kind,
      value_raw: contact.value,
      // Normalisation comes from lib/phone.ts and nowhere else (rule 1).
      value_normalised: normaliseContact(contact.kind, contact.value),
      is_primary: Boolean(contact.isPrimary),
    })),
    { transaction },
  );
}

async function recordOverrides(
  customerId: number,
  matches: duplicateService.DuplicateMatch[],
  actor: Actor,
  transaction: Transaction,
): Promise<void> {
  if (matches.length === 0) return;

  // One row per match, so the record of what was shown is complete rather than
  // summarised (data-model.md).
  await DuplicateOverride.bulkCreate(
    matches.map((match) => ({
      customer_id: customerId,
      matched_customer_id: match.customer.id,
      decided_by_user_id: actor.id,
      matched_on: match.matchedOn,
      matched_value: match.matchedValue,
    })),
    { transaction },
  );

  await auditService.record(
    {
      action: 'customer.duplicate.overridden' as auditService.AuditAction,
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetType: 'customer',
      targetId: customerId,
      metadata: {
        matchedCustomerIds: matches.map((match) => match.customer.id),
        matchedOn: matches.map((match) => match.matchedOn),
      },
    },
    transaction,
  );
}

export async function create(
  input: CustomerInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<CustomerDetail> {
  const details: ErrorDetail[] = [];
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';

  if (displayName === '') {
    details.push({ field: 'displayName', message: 'customer.error.nameRequired' });
  }

  const contacts = assignPrimaries(parseContacts(input.contacts, details));

  if (details.length > 0) {
    throw validationError(details);
  }

  const matches = await duplicateService.findDuplicates({ contacts });

  // A question, not a refusal (FR-023): resubmitting with acknowledgement
  // succeeds and records the decision.
  if (matches.length > 0 && input.acknowledgeDuplicates !== true) {
    throw duplicateCustomer(matches);
  }

  const created = await sequelize.transaction(async (transaction) => {
    const customer = await Customer.create(
      {
        display_name: displayName,
        company: typeof input.company === 'string' ? input.company : null,
        address: typeof input.address === 'string' ? input.address : null,
        is_active: true,
        created_by_user_id: actor.id,
      },
      { transaction },
    );

    await writeContacts(customer.id, contacts, transaction);
    await recordOverrides(customer.id, matches, actor, transaction);

    await auditService.record(
      {
        action: 'customer.created' as auditService.AuditAction,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer',
        targetId: customer.id,
        targetLabel: customer.display_name,
        newValue: { displayName: customer.display_name, company: customer.company },
        ...context,
      },
      transaction,
    );

    /**
     * Phase 11 (FR-024). THE OUTBOX ROW, IN THIS TRANSACTION.
     *
     * Written inside the transaction that creates the customer, for the reason
     * integrations/outbox.ts sets out: written before and rolled back, a webhook
     * fires for a customer that does not exist; written after in a separate
     * step, a crash in between loses it and nobody is ever told.
     *
     * Unlike tickets, customers have no automation event bus to hang this off —
     * Phase 6's triggers are all ticket-shaped — so this is the emission point
     * rather than an observation of an existing one. It still adds no new
     * monitoring (FR-065): a customer being created is already audited on the
     * line above.
     */
    await outbox.record(
      { eventType: 'customer.created', subjectType: 'customer', subjectId: customer.id },
      transaction,
    );

    return customer;
  });

  return getById(created.id);
}

export async function update(
  id: number,
  input: CustomerInput,
  actor: Actor,
  context: AuditContext = {},
): Promise<CustomerDetail> {
  const customer = await Customer.findByPk(id);

  if (!customer) {
    throw notFound();
  }

  if (Number(input.version) !== customer.version) {
    throw staleRecord();
  }

  const details: ErrorDetail[] = [];
  const displayName =
    typeof input.displayName === 'string' ? input.displayName.trim() : customer.display_name;

  if (displayName === '') {
    details.push({ field: 'displayName', message: 'customer.error.nameRequired' });
  }

  const replacingContacts = input.contacts !== undefined;
  const contacts = replacingContacts ? assignPrimaries(parseContacts(input.contacts, details)) : [];

  if (details.length > 0) {
    throw validationError(details);
  }

  // THE SAME detector as create (rule 2, FR-021). Editing a contact into one
  // another customer holds is the identical problem to creating it that way.
  const matches = replacingContacts
    ? await duplicateService.findDuplicates({ contacts, excludeCustomerId: id })
    : [];

  if (matches.length > 0 && input.acknowledgeDuplicates !== true) {
    throw duplicateCustomer(matches);
  }

  const previousValue = { displayName: customer.display_name, company: customer.company };

  await sequelize.transaction(async (transaction) => {
    customer.display_name = displayName;

    if (input.company !== undefined) {
      customer.company = typeof input.company === 'string' ? input.company : null;
    }

    if (input.address !== undefined) {
      customer.address = typeof input.address === 'string' ? input.address : null;
    }

    await customer.save({ transaction });

    if (replacingContacts) {
      await writeContacts(customer.id, contacts, transaction);
      await recordOverrides(customer.id, matches, actor, transaction);
    }

    await auditService.record(
      {
        action: 'customer.updated' as auditService.AuditAction,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer',
        targetId: customer.id,
        targetLabel: customer.display_name,
        previousValue,
        newValue: { displayName: customer.display_name, company: customer.company },
        ...context,
      },
      transaction,
    );
  });

  return getById(customer.id);
}

/**
 * Deactivation is the ONLY removal (Clarifications Q1). There is deliberately
 * no delete method here, and none is to be added — Phase 3 treats a customer
 * reference as permanent.
 */
export async function setActive(
  id: number,
  active: boolean,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const customer = await Customer.findByPk(id);

  if (!customer) {
    throw notFound();
  }

  if (customer.is_active === active) {
    return;
  }

  await sequelize.transaction(async (transaction) => {
    customer.is_active = active;
    await customer.save({ transaction });

    await auditService.record(
      {
        action: (active
          ? 'customer.reactivated'
          : 'customer.deactivated') as auditService.AuditAction,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer',
        targetId: customer.id,
        targetLabel: customer.display_name,
        previousValue: { isActive: !active },
        newValue: { isActive: active },
        ...context,
      },
      transaction,
    );
  });
}

/** Exposed for the check-duplicates endpoint — an aid, never the barrier. */
export async function checkDuplicates(
  rawContacts: unknown,
  excludeCustomerId: number | null,
): Promise<duplicateService.DuplicateMatch[]> {
  const details: ErrorDetail[] = [];
  const contacts = parseContacts(rawContacts, details);

  if (contacts.length === 0) {
    // A live check should not error on a half-typed form.
    return [];
  }

  if (excludeCustomerId !== null && !Number.isInteger(excludeCustomerId)) {
    throw conflict('Invalid customer reference.');
  }

  return duplicateService.findDuplicates({ contacts, excludeCustomerId });
}
