import { sequelize } from '../config/database.js';
import { forbidden, notFound, validationError } from '../errors/app-error.js';
import { Customer, CustomerNote, User } from '../models/index.js';

import * as auditService from './audit.service.js';
import * as authorizationService from './authorization.service.js';
import type { Actor, AuditContext, Paged } from './customer.service.js';
import { clampPageSize } from './customer.service.js';

export interface NoteView {
  id: number;
  body: string;
  author: { id: number; fullName: string };
  createdAt: Date;
  /** Non-null means a human changed what this says (FR-026). */
  editedAt: Date | null;
}

type WithAuthor = CustomerNote & { author?: User };

function toView(note: WithAuthor): NoteView {
  return {
    id: note.id,
    body: note.body,
    author: {
      id: note.author_user_id,
      fullName: note.author?.full_name ?? '',
    },
    createdAt: note.created_at,
    editedAt: note.edited_at,
  };
}

async function requireCustomer(customerId: number): Promise<Customer> {
  const customer = await Customer.findByPk(customerId);

  if (!customer) {
    throw notFound();
  }

  return customer;
}

export async function list(
  customerId: number,
  options: { page?: unknown; pageSize?: unknown } = {},
): Promise<Paged<NoteView>> {
  await requireCustomer(customerId);

  const pageSize = clampPageSize(options.pageSize);
  const requestedPage = Number(options.page);
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;

  const { rows, count } = await CustomerNote.findAndCountAll({
    where: { customer_id: customerId },
    include: [{ model: User, as: 'author' }],
    // Most recent first (FR-025). `id` is the tiebreaker because MySQL DATETIME
    // has second precision — two notes written in the same second would
    // otherwise come back in no defined order, which reads as random shuffling
    // to anyone taking notes quickly during a call.
    order: [
      ['created_at', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    items: rows.map((row) => toView(row as WithAuthor)),
    page,
    pageSize,
    total: count,
  };
}

export async function create(
  customerId: number,
  body: unknown,
  actor: Actor,
  context: AuditContext = {},
): Promise<NoteView> {
  const customer = await requireCustomer(customerId);
  const text = typeof body === 'string' ? body.trim() : '';

  if (text === '') {
    throw validationError([{ field: 'body', message: 'note.error.bodyRequired' }]);
  }

  const created = await sequelize.transaction(async (transaction) => {
    const note = await CustomerNote.create(
      {
        customer_id: customerId,
        author_user_id: actor.id,
        body: text,
        edited_at: null,
      },
      { transaction },
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.CUSTOMER_NOTE_CREATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer',
        targetId: customer.id,
        targetLabel: customer.display_name,
        metadata: { noteId: note.id },
        ...context,
      },
      transaction,
    );

    return note;
  });

  return getById(customerId, created.id);
}

async function getById(customerId: number, noteId: number): Promise<NoteView> {
  const note = await CustomerNote.findOne({
    where: { id: noteId, customer_id: customerId },
    include: [{ model: User, as: 'author' }],
  });

  if (!note) {
    throw notFound();
  }

  return toView(note as WithAuthor);
}

/**
 * A user may always edit their own note. Editing SOMEONE ELSE'S requires
 * `notes:manage` (FR-027).
 *
 * The check goes through authorization.service — a role comparison in a
 * controller is the Phase 1 rule this project has held to since.
 */
async function assertMayModify(note: CustomerNote, actor: Actor, roleId: number): Promise<void> {
  if (note.author_user_id === actor.id) {
    return;
  }

  if (!(await authorizationService.roleHasPermission(roleId, 'notes:manage'))) {
    throw forbidden();
  }
}

export async function update(
  customerId: number,
  noteId: number,
  body: unknown,
  actor: Actor,
  roleId: number,
  context: AuditContext = {},
): Promise<NoteView> {
  const customer = await requireCustomer(customerId);
  const note = await CustomerNote.findOne({ where: { id: noteId, customer_id: customerId } });

  if (!note) {
    throw notFound();
  }

  await assertMayModify(note, actor, roleId);

  const text = typeof body === 'string' ? body.trim() : '';

  if (text === '') {
    throw validationError([{ field: 'body', message: 'note.error.bodyRequired' }]);
  }

  await sequelize.transaction(async (transaction) => {
    note.body = text;
    // Marks it as edited. A silently rewritten note is worse than no note.
    note.edited_at = new Date();
    await note.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.CUSTOMER_NOTE_UPDATED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer',
        targetId: customer.id,
        targetLabel: customer.display_name,
        metadata: { noteId: note.id, authorUserId: note.author_user_id },
        ...context,
      },
      transaction,
    );
  });

  return getById(customerId, noteId);
}

export async function remove(
  customerId: number,
  noteId: number,
  actor: Actor,
  roleId: number,
  context: AuditContext = {},
): Promise<void> {
  const customer = await requireCustomer(customerId);
  const note = await CustomerNote.findOne({ where: { id: noteId, customer_id: customerId } });

  if (!note) {
    throw notFound();
  }

  await assertMayModify(note, actor, roleId);

  await sequelize.transaction(async (transaction) => {
    await note.destroy({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.CUSTOMER_NOTE_DELETED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer',
        targetId: customer.id,
        targetLabel: customer.display_name,
        metadata: { noteId, authorUserId: note.author_user_id },
        ...context,
      },
      transaction,
    );
  });
}
