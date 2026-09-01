import bcrypt from 'bcrypt';
import { Op } from 'sequelize';

import { env } from '../config/env.js';
import {
  invalidCredentials,
  unauthenticated,
  validationError,
  type ErrorDetail,
} from '../errors/app-error.js';
import { Customer, CustomerContact, PortalAccount } from '../models/index.js';

import * as auditService from './audit.service.js';
import * as passwordService from './password.service.js';
import {
  signPortalAccessToken,
  signPortalRefreshToken,
  verifyPortalRefreshToken,
} from './portal-token.service.js';

/**
 * Portal sessions (Phase 8, FR-001 - FR-010, research.md D1, D2, D10).
 *
 * A deliberate sibling of `auth.service.ts` rather than a branch inside it. The
 * two realms share a shape — hash a password, count failures, lock out — and
 * share nothing else: no `users` row, no role, no permission grants, no
 * must-change-password flow, and a different token pair. Merging them would put
 * a realm argument in the security path, which is the one place this project has
 * consistently refused to put one.
 *
 * Phase 1's enumeration defences are copied rather than referenced, because they
 * matter more here. Staff sign-in is reachable by anyone who finds the admin URL;
 * the portal's is reachable by anyone at all, and its email addresses are the
 * organisation's entire customer list.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A real bcrypt hash of a value nobody knows, for the same reason
 * `auth.service.ts` keeps one: comparing against it on the "no such account"
 * path stops the response time distinguishing an unknown address from a wrong
 * password (FR-006, SC-006).
 */
const DUMMY_HASH = '$2b$12$X8O3LLMKBxk1T/XaMJRjHeB9D5kxC1h.Q4HhCRcfcfQFSCNmsAjqG';

export interface PortalSessionContext {
  accountId: number;
  contactId: number;
  customerId: number;
  email: string;
  language: 'ar' | 'en' | null;
}

export interface PortalLoginResult {
  session: PortalSessionContext;
  accessToken: string;
  refreshToken: string;
}

interface LoginContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Loads an account together with everything the middleware must check freshly.
 *
 * ONE QUERY, and the `required: true` includes are load-bearing rather than
 * tidy: they mean a removed contact or a deactivated customer makes this return
 * nothing at all, rather than returning an account whose caller then has to
 * remember to check two more things (FR-003b, FR-009).
 */
async function loadUsable(accountId: number): Promise<PortalAccount | null> {
  return PortalAccount.findOne({
    where: { id: accountId, status: 'active' },
    include: [
      {
        association: 'contact',
        required: true,
        include: [{ association: 'customer', required: true, where: { is_active: true } }],
      },
    ],
  });
}

interface LoadedAccount extends PortalAccount {
  contact: CustomerContact & { customer: Customer };
}

function contextFrom(account: PortalAccount): PortalSessionContext {
  const loaded = account as LoadedAccount;

  return {
    accountId: loaded.id,
    contactId: loaded.contact.id,
    customerId: loaded.contact.customer.id,
    email: loaded.contact.value_raw,
    language: loaded.preferred_language ?? null,
  };
}

/**
 * What `authenticate-portal` calls on EVERY request (research D10).
 *
 * Null for every reason a session must stop working: no such account,
 * withdrawn, contact removed, customer deactivated. The caller is not told
 * which, because all four produce the same 401.
 *
 * A locked-out account is NOT refused here. Lockout stops sign-in attempts; it
 * is not a revocation of a session already held, and treating it as one would
 * mean somebody guessing at a customer's password could log that customer out.
 */
export async function getPortalSessionContext(
  accountId: number,
): Promise<PortalSessionContext | null> {
  const account = await loadUsable(accountId);

  return account ? contextFrom(account) : null;
}

async function recordFailure(
  account: PortalAccount | null,
  email: string,
  context: LoginContext,
  reason: string,
): Promise<void> {
  await auditService.recordAuthEvent({
    action: auditService.AUDIT_ACTIONS.PORTAL_LOGIN_FAILURE,
    outcome: 'failure',
    // NULL, always: a customer is not a `users` row, and putting a
    // `portal_accounts.id` in `actor_user_id` would make it a dangling
    // reference into the staff table.
    actorUserId: null,
    actorEmail: email,
    targetType: 'portal_account',
    targetId: account?.id ?? null,
    targetLabel: email,
    metadata: { reason },
    ...context,
  });
}

async function registerFailedAttempt(
  account: PortalAccount,
  email: string,
  context: LoginContext,
): Promise<void> {
  account.failed_login_attempts += 1;

  // Same thresholds as staff (FR-005). Tracked on `portal_accounts`, so a
  // customer being probed cannot lock out a member of staff and vice versa.
  if (account.failed_login_attempts >= env.AUTH_MAX_FAILED_ATTEMPTS && !account.isLockedOut) {
    account.locked_until = new Date(Date.now() + env.AUTH_LOCKOUT_MINUTES * 60_000);

    await account.save();

    await auditService.recordAuthEvent({
      action: auditService.AUDIT_ACTIONS.PORTAL_ACCOUNT_LOCKED,
      outcome: 'failure',
      actorUserId: null,
      actorEmail: email,
      targetType: 'portal_account',
      targetId: account.id,
      targetLabel: email,
      metadata: { attempts: account.failed_login_attempts },
      ...context,
    });

    return;
  }

  await account.save();
}

/**
 * Finds the portal account for an email address.
 *
 * Matches on `value_normalised`, the column Phase 2's single normalisation site
 * writes — so the address a customer types is compared the same way the address
 * they were invited at was stored.
 *
 * Includes WITHDRAWN accounts and INACTIVE customers on purpose. Sign-in has to
 * refuse them, and refusing them here rather than filtering them out is what
 * keeps the refusal identical to a wrong password (FR-006).
 */
async function findAccountByEmail(normalisedEmail: string): Promise<PortalAccount | null> {
  return PortalAccount.findOne({
    include: [
      {
        association: 'contact',
        required: true,
        where: { kind: 'email', value_normalised: normalisedEmail },
        include: [{ association: 'customer', required: true }],
      },
    ],
  });
}

/**
 * SIX WAYS TO FAIL, ONE ANSWER (FR-006, SC-006).
 *
 * Unknown address, address with no portal account, wrong password, withdrawn
 * account, locked account, deactivated customer — every one returns
 * `invalidCredentials()`, and every one runs a bcrypt compare first so the
 * timing does not separate them either.
 *
 * That matters more here than it does for staff. The portal's addresses are the
 * organisation's customer list, and an endpoint that says "no such account" is
 * an endpoint that confirms one for every address it does not say it about.
 */
export async function login(
  email: unknown,
  password: unknown,
  context: LoginContext = {},
): Promise<PortalLoginResult> {
  const details: ErrorDetail[] = [];
  const normalisedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalisedEmail || !EMAIL_PATTERN.test(normalisedEmail)) {
    details.push({ field: 'email', message: 'A valid email address is required.' });
  }

  if (typeof password !== 'string' || password.length === 0) {
    details.push({ field: 'password', message: 'A password is required.' });
  }

  if (details.length > 0) throw validationError(details);

  const account = await findAccountByEmail(normalisedEmail);

  if (!account) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    // Recorded even though nothing matched, so probing is visible (FR-008).
    await recordFailure(null, normalisedEmail, context, 'unknown_account');
    throw invalidCredentials();
  }

  const loaded = account as LoadedAccount;
  const withdrawn = account.status === 'withdrawn';
  const inactive = !loaded.contact.customer.is_active;

  if (withdrawn || inactive || account.isLockedOut) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    await recordFailure(
      account,
      normalisedEmail,
      context,
      withdrawn ? 'withdrawn' : inactive ? 'customer_inactive' : 'locked',
    );
    throw invalidCredentials();
  }

  if (!(await bcrypt.compare(String(password), account.password_hash))) {
    await registerFailedAttempt(account, normalisedEmail, context);
    await recordFailure(account, normalisedEmail, context, 'wrong_password');
    throw invalidCredentials();
  }

  account.failed_login_attempts = 0;
  account.locked_until = null;
  account.last_login_at = new Date();
  await account.save();

  await auditService.recordAuthEvent({
    action: auditService.AUDIT_ACTIONS.PORTAL_LOGIN_SUCCESS,
    actorUserId: null,
    actorEmail: normalisedEmail,
    targetType: 'portal_account',
    targetId: account.id,
    targetLabel: normalisedEmail,
    ...context,
  });

  return issue(account);
}

/**
 * Mints a session for an account by id.
 *
 * Exists so `portal-invitation.service` can sign a customer in immediately after
 * they accept an invitation without duplicating the token pairing — the epoch
 * claim in particular, which is easy to forget and silently breaks withdrawal.
 */
export async function issueFor(accountId: number): Promise<PortalLoginResult> {
  const account = await loadUsable(accountId);

  if (!account) throw unauthenticated();

  return issue(account);
}

/** One place that mints a pair, so the epoch claim can never be forgotten. */
function issue(account: PortalAccount): PortalLoginResult {
  return {
    session: contextFrom(account),
    accessToken: signPortalAccessToken({ id: account.id }),
    refreshToken: signPortalRefreshToken({ id: account.id, epoch: account.session_epoch }),
  };
}

/**
 * Exchanges a refresh token for a new pair.
 *
 * THE EPOCH CHECK IS THE POINT. A refresh token lives a week, and this is the
 * only endpoint that ever sees one — so it is the only place that can enforce a
 * withdrawal, a credential reset, or a "sign out everywhere" that happened after
 * the token was issued (FR-060, SC-031).
 */
export async function refresh(token: unknown): Promise<PortalLoginResult> {
  if (typeof token !== 'string' || token.length === 0) throw unauthenticated();

  const { id, epoch } = verifyPortalRefreshToken(token);
  const account = await loadUsable(id);

  if (!account || account.session_epoch !== epoch) throw unauthenticated();

  return issue(account);
}

/**
 * Ends every session this account holds, on every device.
 *
 * Used by the customer's own "sign out everywhere", by withdrawal, and by a
 * credential reset. Incrementing rather than setting, so two concurrent calls
 * cannot land on the same value and leave one of them ineffective.
 */
export async function revokeAllSessions(accountId: number): Promise<void> {
  await PortalAccount.increment('session_epoch', { by: 1, where: { id: accountId } });
}

export async function changePassword(
  accountId: number,
  currentPassword: unknown,
  newPassword: unknown,
): Promise<void> {
  const account = await loadUsable(accountId);

  if (!account) throw unauthenticated();

  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    throw validationError([
      { field: 'currentPassword', message: 'Your current password is required.' },
    ]);
  }

  // The SAME policy the staff side enforces (FR-004). A portal password guards
  // a stream of correspondence; there is no argument for a weaker rule, and
  // reusing `validatePolicy` means a future tightening reaches both realms.
  const details = passwordService.validatePolicy(newPassword);

  if (details.length > 0) throw validationError(details);

  if (!(await bcrypt.compare(currentPassword, account.password_hash))) {
    // Deliberately the same error the wrong-password path on sign-in uses.
    throw invalidCredentials();
  }

  account.password_hash = await passwordService.hash(String(newPassword));
  await account.save();

  // A password change ends other sessions. Somebody changing their password
  // because they think it is known should not have to guess whether the other
  // holder is still signed in.
  await revokeAllSessions(accountId);

  await auditService.recordAuthEvent({
    action: auditService.AUDIT_ACTIONS.PORTAL_CREDENTIAL_RESET,
    actorUserId: null,
    actorEmail: contextFrom(account).email,
    targetType: 'portal_account',
    targetId: account.id,
    targetLabel: contextFrom(account).email,
    metadata: { by: 'customer' },
  });
}

/** The one field a customer may change about themselves (FR-064). */
export async function setLanguage(accountId: number, language: unknown): Promise<'ar' | 'en'> {
  if (language !== 'ar' && language !== 'en') {
    throw validationError([{ field: 'language', message: 'Language must be "ar" or "en".' }]);
  }

  await PortalAccount.update({ preferred_language: language }, { where: { id: accountId } });

  return language;
}

/**
 * Every email contact on a customer that could hold portal access, with what it
 * currently holds. Used by the staff screen (FR-056).
 *
 * Here rather than in `portal-access.service.ts` because it reads the same
 * `loadUsable` shape and the same "what counts as usable" rules; the access
 * service owns the ACTIONS, this owns the reading.
 */
export async function accessOverview(customerId: number): Promise<
  Array<{
    contactId: number;
    email: string;
    accountId: number | null;
    status: 'none' | 'invited' | 'active' | 'locked' | 'withdrawn';
    invitationId: number | null;
  }>
> {
  const contacts = await CustomerContact.findAll({
    where: { customer_id: customerId, kind: 'email' },
    include: [
      { association: 'portalAccount', required: false },
      {
        association: 'portalInvitations',
        required: false,
        where: { accepted_at: null, revoked_at: null, expires_at: { [Op.gt]: new Date() } },
      },
    ],
    order: [['id', 'ASC']],
  });

  return contacts.map((contact) => {
    const account = (contact as CustomerContact & { portalAccount?: PortalAccount | null })
      .portalAccount;
    const invitations = (contact as CustomerContact & { portalInvitations?: Array<{ id: number }> })
      .portalInvitations;
    const outstanding = invitations && invitations.length > 0 ? invitations[0] : null;

    if (!account) {
      return {
        contactId: contact.id,
        email: contact.value_raw,
        accountId: null,
        status: outstanding ? ('invited' as const) : ('none' as const),
        invitationId: outstanding?.id ?? null,
      };
    }

    const status =
      account.status === 'withdrawn'
        ? ('withdrawn' as const)
        : account.isLockedOut
          ? ('locked' as const)
          : ('active' as const);

    return {
      contactId: contact.id,
      email: contact.value_raw,
      accountId: account.id,
      status,
      invitationId: outstanding?.id ?? null,
    };
  });
}
