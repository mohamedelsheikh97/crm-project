import { createHash, randomBytes } from 'node:crypto';
import { Op } from 'sequelize';

import { adapterFor } from '../channels/registry.js';
import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../middleware/request-logger.js';
import {
  forbidden,
  invitationInvalid,
  notFound,
  validationError,
  type ErrorDetail,
} from '../errors/app-error.js';
import { Customer, CustomerContact, PortalAccount, PortalInvitation } from '../models/index.js';
import type { InvitationPurpose } from '../models/portal-invitation.model.js';
import {
  invitationBody,
  invitationSubject,
  resetBody,
  resetSubject,
} from '../portal/invitation-mail.js';

import * as auditService from './audit.service.js';
import * as passwordService from './password.service.js';
import * as portalAuthService from './portal-auth.service.js';

/**
 * Invitations and password resets (Phase 8, Clarifications Q1, research.md D3).
 *
 * THE ONLY PATH THAT CREATES A PORTAL ACCOUNT. There is no self-registration, and
 * its absence is a requirement rather than an omission (FR-002a): with it, the
 * system would have to decide what an unrecognised email address means, and every
 * answer is a way for an outsider to claim a customer record. Phase 5 makes that
 * concrete — it creates provisional customer records automatically from inbound
 * traffic, so self-registration would let the sender of one email become the
 * portal identity of the record their email created.
 *
 * THE TOKEN IS NEVER STORED. `token_hash` holds its SHA-256; the value itself
 * exists once, in the email, and in nothing else — not a log line, not an API
 * response, not this function's return value beyond the moment it is sent.
 *
 * SHA-256 RATHER THAN BCRYPT, unlike a password, and the difference is not
 * laziness. Bcrypt's cost exists to survive an offline attack on a low-entropy
 * human secret. This token is 32 random bytes: there is no dictionary to try, the
 * search space is the whole space, and a slow hash would only mean a slow
 * lookup on a hot path. What matters is that the stored form is not usable, and a
 * one-way hash of 256 bits of entropy is that.
 */

/** 32 bytes of entropy, URL-safe. Long enough that guessing is not a strategy. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface LoadedContact extends CustomerContact {
  customer: Customer;
}

async function loadEmailContact(contactId: number): Promise<LoadedContact> {
  const contact = await CustomerContact.findOne({
    where: { id: contactId, kind: 'email' },
    include: [{ association: 'customer', required: true }],
  });

  // notFound rather than a message naming the reason: a staff caller guessing at
  // contact ids should not learn which ones are phone numbers.
  if (!contact) throw notFound();

  return contact as LoadedContact;
}

/**
 * Where the acceptance link points.
 *
 * `CORS_ORIGIN` is the application's own origin and is already required, already
 * an explicit value (the schema refuses `*`), and already the place the portal is
 * served from. A new `PORTAL_BASE_URL` would be a second copy of the same fact,
 * and two copies of a URL is how you get an invitation that links to the wrong
 * host after a deployment.
 */
function portalUrl(path: string): string {
  return `${env.CORS_ORIGIN.replace(/\/+$/, '')}${path}`;
}

export interface IssueResult {
  invitationId: number;
  email: string;
  /**
   * TRUE when the customer record was created automatically from an inbound
   * message and nobody has verified it (FR-002f).
   *
   * Returned rather than refused. Forbidding it outright would leave every
   * customer Phase 5 created automatically permanently unable to use the portal,
   * which is most of them in a busy deployment. But it is a real risk — nobody
   * has confirmed this address belongs to whoever the record claims — so the
   * issuer is told, in the response, and the interface shows it before
   * confirming. The RULE lives here rather than in the screen (FR-002f).
   */
  provisionalWarning: boolean;
}

/**
 * Issues an invitation to an email contact.
 *
 * REVOKES ANY OUTSTANDING ONE FIRST. Two live invitations for one contact would
 * mean two tokens that both work, and "I sent it again" is the commonest reason
 * for a second — so the second must retire the first rather than sit beside it.
 */
export async function issue(
  contactId: number,
  actor: { id: number; email: string },
  context: Pick<auditService.AuditEntry, 'ipAddress' | 'userAgent'> = {},
): Promise<IssueResult> {
  const contact = await loadEmailContact(contactId);

  if (!contact.customer.is_active) {
    throw validationError([
      {
        field: 'contactId',
        message: 'This customer is deactivated and cannot be invited to the portal.',
      },
    ]);
  }

  const existingAccount = await PortalAccount.findOne({
    where: { customer_contact_id: contactId },
  });

  if (existingAccount && existingAccount.status === 'active') {
    throw validationError([
      { field: 'contactId', message: 'This contact already has portal access.' },
    ]);
  }

  const token = newToken();

  const invitation = await sequelize.transaction(async (transaction) => {
    await PortalInvitation.update(
      { revoked_at: new Date(), revoked_by_user_id: actor.id },
      {
        where: {
          customer_contact_id: contactId,
          purpose: 'invitation',
          accepted_at: null,
          revoked_at: null,
        },
        transaction,
      },
    );

    const created = await PortalInvitation.create(
      {
        customer_contact_id: contactId,
        token_hash: hashToken(token),
        purpose: 'invitation',
        issued_by_user_id: actor.id,
        expires_at: new Date(Date.now() + env.PORTAL_INVITE_TTL_HOURS * 3_600_000),
        accepted_at: null,
        revoked_at: null,
        revoked_by_user_id: null,
      },
      { transaction },
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PORTAL_INVITATION_ISSUED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer_contact',
        targetId: contactId,
        targetLabel: contact.value_raw,
        metadata: {
          customerId: contact.customer.id,
          provisionalCustomer: contact.customer.is_provisional,
        },
        ...context,
      },
      transaction,
    );

    return created;
  });

  await deliver(contact, token, 'invitation');

  return {
    invitationId: invitation.id,
    email: contact.value_raw,
    provisionalWarning: contact.customer.is_provisional,
  };
}

/**
 * Sends the token.
 *
 * ALWAYS TO `contact.value_raw` (FR-002d). There is no parameter for an address,
 * and there must never be one: an invitation redirectable at issue time is an
 * invitation to any address a caller chooses, which would turn `portal:manage`
 * into "may grant a stranger access to any customer's correspondence". This is
 * the same refusal `message.service.conversationFor` makes for replies.
 *
 * The adapter is called DIRECTLY and NO `messages` ROW IS WRITTEN, following
 * `alert.service.ts`. Phase 6 recorded why: `messages` is the correspondence
 * structure this phase builds a customer-facing view on, and operational traffic
 * about an account must not enter it. An invitation is not part of the
 * conversation about a request.
 *
 * A DELIVERY FAILURE DOES NOT ROLL BACK THE ROW. The invitation exists, is
 * revocable, and can be reissued; discarding it because the mail server hiccuped
 * would leave the staff member with no record of what they just did.
 */
async function deliver(
  contact: LoadedContact,
  token: string,
  purpose: InvitationPurpose,
): Promise<void> {
  const adapter = adapterFor('email');

  const body =
    purpose === 'invitation'
      ? invitationBody({
          organisationName: contact.customer.display_name,
          email: contact.value_raw,
          acceptUrl: portalUrl(`/portal/invite/${token}`),
          expiresInHours: env.PORTAL_INVITE_TTL_HOURS,
        })
      : resetBody({
          email: contact.value_raw,
          resetUrl: portalUrl(`/portal/reset/${token}`),
          expiresInHours: RESET_TTL_HOURS,
        });

  try {
    await adapter.send({
      channel: 'email',
      recipientIdentity: contact.value_raw,
      body,
      subject: purpose === 'invitation' ? invitationSubject() : resetSubject(),
      providerConversationId: null,
      replyToToken: null,
    });
  } catch (error) {
    // Logged loudly rather than thrown: see the header. The staff member's
    // action succeeded; the email did not, and they can reissue.
    logger.error(
      { err: error, contactId: contact.id, purpose },
      'PORTAL INVITATION MAIL FAILED — the token was created but not delivered',
    );
  }
}

/**
 * A reset link is SHORTER-LIVED than an invitation.
 *
 * An invitation has to survive a holiday: it is sent on somebody else's schedule
 * and the recipient was not waiting for it. A reset was requested seconds ago by
 * somebody sitting at the sign-in screen, so a long window buys nothing and
 * leaves a live credential in a mailbox.
 */
const RESET_TTL_HOURS = 2;

/**
 * Looks a token up and refuses uniformly.
 *
 * ONE ERROR FOR FOUR CAUSES — expired, spent, revoked, and never existed
 * (FR-002c). The distinction is not made HERE rather than being made and then
 * flattened at the controller, because a flattening step is a step somebody can
 * skip. `invitationInvalid()` is the only thing this can throw.
 */
async function findUsable(
  token: unknown,
  purpose: InvitationPurpose,
): Promise<{ invitation: PortalInvitation; contact: LoadedContact }> {
  if (typeof token !== 'string' || token.length === 0) throw invitationInvalid();

  const invitation = await PortalInvitation.findOne({
    where: { token_hash: hashToken(token), purpose },
    include: [
      {
        association: 'contact',
        required: true,
        include: [{ association: 'customer', required: true }],
      },
    ],
  });

  if (!invitation || !invitation.isUsable) throw invitationInvalid();

  const contact = (invitation as PortalInvitation & { contact: LoadedContact }).contact;

  // A deactivated customer's invitation is dead, and dead in the same way as a
  // token that never existed. Anything else tells the holder that the record is
  // real but switched off.
  if (!contact.customer.is_active) throw invitationInvalid();

  return { invitation, contact };
}

export interface InvitationView {
  /** Enough to render the acceptance screen, and nothing more. */
  organisationName: string;
  email: string;
  purpose: InvitationPurpose;
}

/**
 * What the acceptance page may know before anybody proves anything.
 *
 * THE MINIMUM. The organisation's name and the address, so the recipient can
 * decide whether the email is genuine — which is the whole risk this screen
 * carries. No tickets, no contact list, no confirmation of any other fact about
 * the record. Holding a token is not being signed in.
 */
export async function view(token: unknown, purpose: InvitationPurpose): Promise<InvitationView> {
  const { contact } = await findUsable(token, purpose);

  return {
    organisationName: contact.customer.display_name,
    email: contact.value_raw,
    purpose,
  };
}

/**
 * Redeems an invitation: creates the account and signs the customer in.
 *
 * SINGLE USE (FR-002b). `accepted_at` is stamped in the same transaction as the
 * account is created, so a replay finds a spent invitation and gets the same
 * refusal as an expired one.
 *
 * THE ACCOUNT IS BOUND TO THE INVITATION'S CONTACT, not to anything the caller
 * sent. There is no contact or customer parameter on this function, and there
 * must not be one.
 */
export async function accept(
  token: unknown,
  password: unknown,
  language: unknown,
  context: Pick<auditService.AuditEntry, 'ipAddress' | 'userAgent'> = {},
): Promise<portalAuthService.PortalLoginResult> {
  const { invitation, contact } = await findUsable(token, 'invitation');

  const details: ErrorDetail[] = passwordService.validatePolicy(password, 'password');

  if (details.length > 0) throw validationError(details);

  const preferred = language === 'ar' || language === 'en' ? language : null;

  const account = await sequelize.transaction(async (transaction) => {
    // A withdrawn account being re-invited is reactivated rather than
    // duplicated: the unique index on customer_contact_id means there is only
    // ever one row, and the history of who withdrew it stays in the audit log.
    const existing = await PortalAccount.findOne({
      where: { customer_contact_id: contact.id },
      transaction,
    });

    const passwordHash = await passwordService.hash(String(password));
    const now = new Date();

    let saved: PortalAccount;

    if (existing) {
      existing.password_hash = passwordHash;
      existing.status = 'active';
      existing.failed_login_attempts = 0;
      existing.locked_until = null;
      existing.activated_at = now;
      existing.preferred_language = preferred;
      existing.invited_by_user_id = invitation.issued_by_user_id;
      // Any session held under the previous incarnation of this account is dead.
      existing.session_epoch += 1;
      await existing.save({ transaction });
      saved = existing;
    } else {
      saved = await PortalAccount.create(
        {
          customer_contact_id: contact.id,
          password_hash: passwordHash,
          status: 'active',
          failed_login_attempts: 0,
          locked_until: null,
          session_epoch: 0,
          invited_by_user_id: invitation.issued_by_user_id,
          activated_at: now,
          last_login_at: now,
          preferred_language: preferred,
        },
        { transaction },
      );
    }

    invitation.accepted_at = now;
    await invitation.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PORTAL_INVITATION_ACCEPTED,
        // The customer is the actor and has no `users` row, so this is null and
        // the address carries the identity.
        actorUserId: null,
        actorEmail: contact.value_raw,
        targetType: 'portal_account',
        targetId: saved.id,
        targetLabel: contact.value_raw,
        metadata: { customerId: contact.customer.id, invitationId: invitation.id },
        ...context,
      },
      transaction,
    );

    return saved;
  });

  // Reloaded through the auth service so the session context is built by the one
  // function that knows how, rather than assembled a second way here.
  const session = await portalAuthService.getPortalSessionContext(account.id);

  if (!session) throw invitationInvalid();

  return portalAuthService.issueFor(account.id);
}

/** Revokes an outstanding invitation (FR-002c). */
export async function revoke(
  invitationId: number,
  actor: { id: number; email: string },
  context: Pick<auditService.AuditEntry, 'ipAddress' | 'userAgent'> = {},
): Promise<void> {
  const invitation = await PortalInvitation.findByPk(invitationId, {
    include: [{ association: 'contact', required: true }],
  });

  if (!invitation) throw notFound();

  // Already spent or already revoked: nothing to do, and saying which would be
  // the same disclosure the acceptance path refuses to make.
  if (!invitation.isUsable) throw invitationInvalid();

  await sequelize.transaction(async (transaction) => {
    invitation.revoked_at = new Date();
    invitation.revoked_by_user_id = actor.id;
    await invitation.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PORTAL_INVITATION_REVOKED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'customer_contact',
        targetId: invitation.customer_contact_id,
        targetLabel: (invitation as PortalInvitation & { contact: CustomerContact }).contact
          .value_raw,
        metadata: { invitationId: invitation.id },
        ...context,
      },
      transaction,
    );
  });
}

/**
 * Starts a password reset.
 *
 * ALWAYS SUCCEEDS FROM THE CALLER'S POINT OF VIEW (FR-006). An address with no
 * portal account produces no email and no error — identical behaviour, because
 * anything else makes this endpoint a way to enumerate the organisation's
 * customer list one address at a time.
 *
 * `actor` is optional: a customer requesting their own reset has no staff actor,
 * and a staff member sending one on their behalf does.
 */
export async function requestReset(
  email: unknown,
  actor: { id: number; email: string } | null = null,
  context: Pick<auditService.AuditEntry, 'ipAddress' | 'userAgent'> = {},
): Promise<void> {
  const normalised = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalised) return;

  const contact = (await CustomerContact.findOne({
    where: { kind: 'email', value_normalised: normalised },
    include: [
      { association: 'customer', required: true, where: { is_active: true } },
      { association: 'portalAccount', required: true, where: { status: 'active' } },
    ],
  })) as LoadedContact | null;

  if (!contact) return;

  const token = newToken();

  await sequelize.transaction(async (transaction) => {
    await PortalInvitation.update(
      { revoked_at: new Date(), revoked_by_user_id: actor?.id ?? null },
      {
        where: {
          customer_contact_id: contact.id,
          purpose: 'password_reset',
          accepted_at: null,
          revoked_at: null,
        },
        transaction,
      },
    );

    await PortalInvitation.create(
      {
        customer_contact_id: contact.id,
        token_hash: hashToken(token),
        purpose: 'password_reset',
        issued_by_user_id: actor?.id ?? null,
        expires_at: new Date(Date.now() + RESET_TTL_HOURS * 3_600_000),
        accepted_at: null,
        revoked_at: null,
        revoked_by_user_id: null,
      },
      { transaction },
    );

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PORTAL_CREDENTIAL_RESET,
        actorUserId: actor?.id ?? null,
        actorEmail: actor?.email ?? contact.value_raw,
        targetType: 'customer_contact',
        targetId: contact.id,
        targetLabel: contact.value_raw,
        metadata: { by: actor ? 'staff' : 'customer' },
        ...context,
      },
      transaction,
    );
  });

  await deliver(contact, token, 'password_reset');
}

/**
 * Completes a password reset.
 *
 * ENDS EVERY OTHER SESSION. Somebody resetting a password because they believe
 * it is known should not have to wonder whether the other holder is still signed
 * in (FR-060).
 */
export async function completeReset(token: unknown, password: unknown): Promise<void> {
  const { invitation, contact } = await findUsable(token, 'password_reset');

  const details = passwordService.validatePolicy(password, 'password');

  if (details.length > 0) throw validationError(details);

  const account = await PortalAccount.findOne({ where: { customer_contact_id: contact.id } });

  // The account existed when the reset was requested and does not now. Same
  // uniform refusal: the holder of this token learns nothing either way.
  if (!account || account.status !== 'active') throw invitationInvalid();

  await sequelize.transaction(async (transaction) => {
    account.password_hash = await passwordService.hash(String(password));
    account.failed_login_attempts = 0;
    account.locked_until = null;
    account.session_epoch += 1;
    await account.save({ transaction });

    invitation.accepted_at = new Date();
    await invitation.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PORTAL_CREDENTIAL_RESET,
        actorUserId: null,
        actorEmail: contact.value_raw,
        targetType: 'portal_account',
        targetId: account.id,
        targetLabel: contact.value_raw,
        metadata: { by: 'customer', completed: true },
      },
      transaction,
    );
  });
}

/**
 * Sends a reset on a customer's behalf, from the staff screen (FR-057).
 *
 * Named separately from `requestReset` so the permission check has one obvious
 * place to sit, and so the staff path can fail loudly for a contact with no
 * account — which is useful to the staff member and would be a disclosure if the
 * customer-facing path did it.
 */
export async function sendResetFor(
  contactId: number,
  actor: { id: number; email: string },
  context: Pick<auditService.AuditEntry, 'ipAddress' | 'userAgent'> = {},
): Promise<void> {
  const contact = await loadEmailContact(contactId);
  const account = await PortalAccount.findOne({ where: { customer_contact_id: contactId } });

  if (!account) throw notFound();

  if (account.status !== 'active') {
    throw forbidden([
      { field: 'accountId', message: 'This account has been withdrawn. Restore it first.' },
    ]);
  }

  await requestReset(contact.value_normalised, actor, context);
}

/** Outstanding invitations for a contact. Used by the staff overview (FR-056). */
export async function outstandingFor(contactId: number): Promise<PortalInvitation | null> {
  return PortalInvitation.findOne({
    where: {
      customer_contact_id: contactId,
      purpose: 'invitation',
      accepted_at: null,
      revoked_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
    order: [['id', 'DESC']],
  });
}
