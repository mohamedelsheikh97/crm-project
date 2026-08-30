import { sequelize } from '../config/database.js';

import { AuditLog } from './audit-log.model.js';
import { CustomerAttachment } from './customer-attachment.model.js';
import { CustomerContact } from './customer-contact.model.js';
import { CustomerNote } from './customer-note.model.js';
import { Customer } from './customer.model.js';
import { DuplicateOverride } from './duplicate-override.model.js';
import { Notification } from './notification.model.js';
import { PasswordHistory } from './password-history.model.js';
import { ReplyTemplate } from './reply-template.model.js';
import { RolePermission } from './role-permission.model.js';
import { Role } from './role.model.js';
import { Task } from './task.model.js';
import { TicketHistory } from './ticket-history.model.js';
import { TicketLink } from './ticket-link.model.js';
import { TicketNoteMention } from './ticket-note-mention.model.js';
import { TicketNote } from './ticket-note.model.js';
import { Ticket } from './ticket.model.js';
import { User } from './user.model.js';

// Associations are declared in one place so the relationship wiring is
// reviewable at a glance rather than scattered across ten files.

// --- Phase 1: users, roles, permissions, audit ---
Role.hasMany(User, { foreignKey: 'role_id', as: 'users' });
User.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

Role.hasMany(RolePermission, { foreignKey: 'role_id', as: 'permissions' });
RolePermission.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

User.hasMany(PasswordHistory, { foreignKey: 'user_id', as: 'passwordHistory' });
PasswordHistory.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Nullable: a failed sign-in against an unknown identifier has no actor.
User.hasMany(AuditLog, { foreignKey: 'actor_user_id', as: 'auditEntries' });
AuditLog.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actor' });

// --- Phase 2: customers ---
// Customers are never deleted (Clarifications Q1), so every cascade below
// exists for schema correctness rather than as an expected path — the same
// posture Phase 1 took with users.
Customer.hasMany(CustomerContact, { foreignKey: 'customer_id', as: 'contacts' });
CustomerContact.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

Customer.hasMany(CustomerNote, { foreignKey: 'customer_id', as: 'notes' });
CustomerNote.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
CustomerNote.belongsTo(User, { foreignKey: 'author_user_id', as: 'author' });

Customer.hasMany(CustomerAttachment, { foreignKey: 'customer_id', as: 'attachments' });
CustomerAttachment.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
CustomerAttachment.belongsTo(User, { foreignKey: 'uploaded_by_user_id', as: 'uploader' });

Customer.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });

// A customer appears on both sides of an override: as the record being saved
// and as the record the user was warned about.
DuplicateOverride.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
DuplicateOverride.belongsTo(Customer, {
  foreignKey: 'matched_customer_id',
  as: 'matchedCustomer',
});
DuplicateOverride.belongsTo(User, { foreignKey: 'decided_by_user_id', as: 'decidedBy' });

// --- Phase 3: tickets ---
Customer.hasMany(Ticket, { foreignKey: 'customer_id', as: 'tickets' });
Ticket.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

Ticket.belongsTo(User, { foreignKey: 'assignee_user_id', as: 'assignee' });
Ticket.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });

Ticket.hasMany(TicketHistory, { foreignKey: 'ticket_id', as: 'history' });
TicketHistory.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
TicketHistory.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actor' });

// A merged ticket points at the one that absorbed it. Chains are resolved
// transitively in the service rather than eagerly here, because the depth is
// unbounded and a cycle must be refused rather than followed (research.md D3).
Ticket.belongsTo(Ticket, { foreignKey: 'merged_into_ticket_id', as: 'mergedInto' });

// A link is symmetric and stored once, normalised so the lower id is
// `ticket_id`. Both associations exist so a read can reach either side.
TicketLink.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
TicketLink.belongsTo(Ticket, { foreignKey: 'linked_ticket_id', as: 'linkedTicket' });
TicketLink.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });

// --- Phase 4: dashboard, notes, notifications, tasks, templates ---

// Internal notes. Separate from CustomerNote on purpose (research.md D5).
Ticket.hasMany(TicketNote, { foreignKey: 'ticket_id', as: 'notes' });
TicketNote.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
TicketNote.belongsTo(User, { foreignKey: 'author_user_id', as: 'author' });

// The mention rows are what the interface renders `@[user:12]` tokens from, so
// a rename or deactivation never misattributes a note (FR-035, FR-041).
TicketNote.hasMany(TicketNoteMention, { foreignKey: 'note_id', as: 'mentions' });
TicketNoteMention.belongsTo(TicketNote, { foreignKey: 'note_id', as: 'note' });
TicketNoteMention.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Tasks are personal (Clarifications Q3): one owner, no assignee association,
// because there is no such action.
User.hasMany(Task, { foreignKey: 'owner_user_id', as: 'tasks' });
Task.belongsTo(User, { foreignKey: 'owner_user_id', as: 'owner' });
Task.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
Task.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

// A notification belongs to its RECIPIENT. `actor` is nullable because
// task.reminder and ticket.due_soon are system-generated — nobody caused them.
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'recipient' });
Notification.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actor' });
Notification.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
Notification.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
Notification.belongsTo(TicketNote, { foreignKey: 'note_id', as: 'note' });

ReplyTemplate.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });

export {
  sequelize,
  AuditLog,
  Customer,
  CustomerAttachment,
  CustomerContact,
  CustomerNote,
  DuplicateOverride,
  Notification,
  PasswordHistory,
  ReplyTemplate,
  Role,
  RolePermission,
  Task,
  Ticket,
  TicketHistory,
  TicketLink,
  TicketNote,
  TicketNoteMention,
  User,
};
