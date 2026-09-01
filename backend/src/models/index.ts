import { sequelize } from '../config/database.js';

import { AlertDelivery } from './alert-delivery.model.js';
import { AlertSubscription } from './alert-subscription.model.js';
import { AssignmentSetting } from './assignment-setting.model.js';
import { AuditLog } from './audit-log.model.js';
import { AutomationRule } from './automation-rule.model.js';
import { AutomationRun } from './automation-run.model.js';
import { BusinessCalendar } from './business-calendar.model.js';
import { CalendarException } from './calendar-exception.model.js';
import { ChannelIntake } from './channel-intake.model.js';
import { ChannelOptOut } from './channel-opt-out.model.js';
import { ChannelSetting } from './channel-setting.model.js';
import { ChatSession } from './chat-session.model.js';
import { CustomerAttachment } from './customer-attachment.model.js';
import { CustomerContact } from './customer-contact.model.js';
import { CustomerNote } from './customer-note.model.js';
import { Customer } from './customer.model.js';
import { DuplicateOverride } from './duplicate-override.model.js';
import { FormDefinition } from './form-definition.model.js';
import { KbArticleTerm } from './kb-article-term.model.js';
import { KbArticle } from './kb-article.model.js';
import { KbCategory } from './kb-category.model.js';
import { KbGuideStep } from './kb-guide-step.model.js';
import { KbGuide } from './kb-guide.model.js';
import { KbTicketArticle } from './kb-ticket-article.model.js';
import { MessageAttachment } from './message-attachment.model.js';
import { Message } from './message.model.js';
import { Notification } from './notification.model.js';
import { PasswordHistory } from './password-history.model.js';
import { PortalAccount } from './portal-account.model.js';
import { PortalInvitation } from './portal-invitation.model.js';
import { ReplyTemplate } from './reply-template.model.js';
import { RolePermission } from './role-permission.model.js';
import { Role } from './role.model.js';
import { SlaPolicy } from './sla-policy.model.js';
import { Task } from './task.model.js';
import { TicketSla } from './ticket-sla.model.js';
import { TicketHistory } from './ticket-history.model.js';
import { TicketLink } from './ticket-link.model.js';
import { TicketNoteMention } from './ticket-note-mention.model.js';
import { TicketNote } from './ticket-note.model.js';
import { TicketSatisfaction } from './ticket-satisfaction.model.js';
import { Ticket } from './ticket.model.js';
import { UserCompetency } from './user-competency.model.js';
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

// --- Phase 5: communication channels ---

// Customer correspondence. Deliberately a SIBLING of TicketNote rather than a
// flag on it: a note is written to a colleague, a message is exchanged with a
// customer, and one table with a boolean deciding which is the design FR-002,
// FR-044 and SC-006 exist to prevent.
Ticket.hasMany(Message, { foreignKey: 'ticket_id', as: 'messages' });
Message.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
// Set on outbound, null on inbound. RESTRICT at the database, so an agent who
// leaves does not take their correspondence with them.
Message.belongsTo(User, { foreignKey: 'author_user_id', as: 'author' });

Message.hasMany(MessageAttachment, { foreignKey: 'message_id', as: 'attachments' });
MessageAttachment.belongsTo(Message, { foreignKey: 'message_id', as: 'message' });

// The ledger points AT a message rather than the other way round: a delivery
// that was ignored or failed produced none, and those are precisely the rows
// most likely to be redelivered.
ChannelIntake.belongsTo(Message, { foreignKey: 'message_id', as: 'message' });

ChannelSetting.belongsTo(User, { foreignKey: 'updated_by_user_id', as: 'updatedBy' });

// A chat session becomes a ticket at the first message, not at the moment the
// panel opens — a visitor who opens and closes it has not raised anything.
ChatSession.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
Ticket.hasOne(ChatSession, { foreignKey: 'ticket_id', as: 'chatSession' });

FormDefinition.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });

// ChannelOptOut has NO association. It is keyed by (channel, identity) and
// deliberately not by customer, so a merge, a split, or a contact moving
// between records cannot resurrect consent (FR-051, FR-060, FR-065).

// --- Phase 6: SLA & automation ---

// hasOne, not hasMany: `ticket_sla.ticket_id` is the primary key, so one row
// per ticket is a schema guarantee rather than a service convention (D1). The
// association is OPTIONAL by nature — a ticket matching no policy has no row at
// all, which is FR-014 made structural.
Ticket.hasOne(TicketSla, { foreignKey: 'ticket_id', as: 'sla' });
TicketSla.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
TicketSla.belongsTo(SlaPolicy, { foreignKey: 'policy_id', as: 'policy' });

SlaPolicy.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });

BusinessCalendar.hasMany(CalendarException, { foreignKey: 'calendar_id', as: 'exceptions' });
CalendarException.belongsTo(BusinessCalendar, { foreignKey: 'calendar_id', as: 'calendar' });
BusinessCalendar.belongsTo(User, { foreignKey: 'updated_by_user_id', as: 'updatedBy' });

AssignmentSetting.belongsTo(User, { foreignKey: 'updated_by_user_id', as: 'updatedBy' });
AssignmentSetting.belongsTo(User, { foreignKey: 'round_robin_cursor_user_id', as: 'cursorUser' });

User.hasMany(UserCompetency, { foreignKey: 'user_id', as: 'competencies' });
UserCompetency.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

AutomationRule.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });

// SET NULL, not CASCADE, and the denormalised `rule_name` beside it: FR-070
// says the record of what a rule did outlives the rule.
AutomationRun.belongsTo(AutomationRule, { foreignKey: 'rule_id', as: 'rule' });
AutomationRun.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });

AlertSubscription.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

AlertDelivery.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
AlertDelivery.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
AlertDelivery.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

// --- Phase 7: Knowledge base ---

// RESTRICT on the category (declared in the migration), not CASCADE: FR-015
// forbids orphaning an article, and the service turns the refusal into a
// message naming how many articles stand in the way.
KbCategory.hasMany(KbArticle, { foreignKey: 'category_id', as: 'articles' });
KbArticle.belongsTo(KbCategory, { foreignKey: 'category_id', as: 'category' });

KbArticle.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });
KbArticle.belongsTo(User, { foreignKey: 'updated_by_user_id', as: 'updatedBy' });
KbArticle.belongsTo(User, { foreignKey: 'published_by_user_id', as: 'publishedBy' });

// The search index. CASCADE is exactly right here and nowhere else in this
// project: an index row has no meaning without its article.
KbArticle.hasMany(KbArticleTerm, { foreignKey: 'article_id', as: 'terms' });
KbArticleTerm.belongsTo(KbArticle, { foreignKey: 'article_id', as: 'article' });

// A JOIN, NOT A CONTAINER (research D9). The article is unaware it is in a
// guide, stays in its category, and may appear in several guides — which is why
// this is an explicit join model rather than a guide id column on the article.
// Modelling a guide as a kind of article would have forced every article query
// in the system to learn to exclude containers.
KbGuide.hasMany(KbGuideStep, { foreignKey: 'guide_id', as: 'steps' });
KbGuideStep.belongsTo(KbGuide, { foreignKey: 'guide_id', as: 'guide' });
KbGuideStep.belongsTo(KbArticle, { foreignKey: 'article_id', as: 'article' });
KbArticle.hasMany(KbGuideStep, { foreignKey: 'article_id', as: 'guideSteps' });

// DELIBERATE attachments only — never suggestions, which are computed on read
// and never stored (FR-042). A null attached_by_user_id means a rule did it.
Ticket.hasMany(KbTicketArticle, { foreignKey: 'ticket_id', as: 'knowledgeArticles' });
KbTicketArticle.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
KbTicketArticle.belongsTo(KbArticle, { foreignKey: 'article_id', as: 'article' });
KbTicketArticle.belongsTo(User, { foreignKey: 'attached_by_user_id', as: 'attachedBy' });

// --- Phase 8: Customer portal ---
//
// EVERY EDGE HERE HANGS OFF `customer_contacts`, NOT `customers`, and that is
// Clarifications Q2 expressed as wiring. A portal account belongs to one
// contact; a ticket records the one contact that raised it; a satisfaction
// response records the contact that gave it. Nothing in this block can answer
// "which tickets does this CUSTOMER's portal show?", because that is not a
// question the portal is allowed to ask.

// CASCADE, uniquely appropriate here: an account has no meaning without the
// contact it authenticates. FR-003b wants removing the contact to end the
// access rather than leave a credential resolving to nothing.
CustomerContact.hasOne(PortalAccount, { foreignKey: 'customer_contact_id', as: 'portalAccount' });
PortalAccount.belongsTo(CustomerContact, { foreignKey: 'customer_contact_id', as: 'contact' });
PortalAccount.belongsTo(User, { foreignKey: 'invited_by_user_id', as: 'invitedBy' });

CustomerContact.hasMany(PortalInvitation, {
  foreignKey: 'customer_contact_id',
  as: 'portalInvitations',
});
PortalInvitation.belongsTo(CustomerContact, { foreignKey: 'customer_contact_id', as: 'contact' });
PortalInvitation.belongsTo(User, { foreignKey: 'issued_by_user_id', as: 'issuedBy' });
PortalInvitation.belongsTo(User, { foreignKey: 'revoked_by_user_id', as: 'revokedBy' });

// SET NULL, not CASCADE: removing a contact must not delete a ticket. The
// ticket becomes invisible in the portal, which is the correct fail-closed
// outcome (FR-026f).
Ticket.belongsTo(CustomerContact, { foreignKey: 'requesting_contact_id', as: 'requestingContact' });
CustomerContact.hasMany(Ticket, { foreignKey: 'requesting_contact_id', as: 'requestedTickets' });

// hasOne, because the unique index on ticket_id means there is at most one
// (FR-049). A hasMany here would invite a caller to render a list and quietly
// tolerate the second row the database will never let exist.
Ticket.hasOne(TicketSatisfaction, { foreignKey: 'ticket_id', as: 'satisfaction' });
TicketSatisfaction.belongsTo(Ticket, { foreignKey: 'ticket_id', as: 'ticket' });
TicketSatisfaction.belongsTo(CustomerContact, {
  foreignKey: 'submitted_by_contact_id',
  as: 'submittedBy',
});

export {
  sequelize,
  AlertDelivery,
  AlertSubscription,
  AssignmentSetting,
  AuditLog,
  AutomationRule,
  AutomationRun,
  BusinessCalendar,
  CalendarException,
  ChannelIntake,
  ChannelOptOut,
  ChannelSetting,
  ChatSession,
  Customer,
  CustomerAttachment,
  CustomerContact,
  CustomerNote,
  DuplicateOverride,
  FormDefinition,
  KbArticle,
  KbArticleTerm,
  KbCategory,
  KbGuide,
  KbGuideStep,
  KbTicketArticle,
  Message,
  MessageAttachment,
  Notification,
  PasswordHistory,
  PortalAccount,
  PortalInvitation,
  ReplyTemplate,
  Role,
  RolePermission,
  SlaPolicy,
  Task,
  Ticket,
  TicketHistory,
  TicketLink,
  TicketNote,
  TicketNoteMention,
  TicketSatisfaction,
  TicketSla,
  User,
  UserCompetency,
};
