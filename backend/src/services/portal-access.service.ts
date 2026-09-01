import { sequelize } from '../config/database.js';
import { forbidden, notFound } from '../errors/app-error.js';
import { CustomerContact, PortalAccount } from '../models/index.js';

import * as auditService from './audit.service.js';
import * as portalAuthService from './portal-auth.service.js';

/**
 * Staff administration of portal access (Phase 8, FR-056 - FR-060a, User Story 8).
 *
 * THE REMEDY. Everything else in this phase is about letting a customer in; this
 * is the file that lets somebody take it away again, and without it the phase is
 * demonstrable but not operable — a shared or compromised customer credential
 * would have no answer.
 *
 * Every function here is reached only behind `requirePermission('portal:manage')`,
 * enforced server-side on the route (FR-059). The permission is deliberately
 * distinct from `customers:update`: handing out portal access and rewriting a
 * customer's address are different judgements, and a team lead may reasonably be
 * trusted with one and not the other (FR-058).
 *
 * WITHDRAWAL IS NOT DELETION. The row stays, `status` becomes `withdrawn`, and
 * the audit trail of who did it stays readable. Restoring is one action, which
 * matters because "we withdrew the wrong person's access on a Friday" is a thing
 * that happens.
 */

interface Actor {
  id: number;
  email: string;
}

type AuditContext = Pick<auditService.AuditEntry, 'ipAddress' | 'userAgent'>;

/** Per contact on a customer: who has access, who was invited, who is locked out. */
export async function overview(customerId: number) {
  return portalAuthService.accessOverview(customerId);
}

interface LoadedAccount extends PortalAccount {
  contact: CustomerContact;
}

async function loadAccount(accountId: number): Promise<LoadedAccount> {
  const account = await PortalAccount.findByPk(accountId, {
    include: [{ association: 'contact', required: true }],
  });

  if (!account) throw notFound();

  return account as LoadedAccount;
}

/**
 * Ends this contact's access (FR-060, FR-060a).
 *
 * TWO THINGS, AND BOTH ARE NEEDED. `status = 'withdrawn'` is what the
 * middleware's per-request freshness read sees, which kills every access token
 * within its ten minutes and in practice on the next request. Bumping
 * `session_epoch` is what kills the REFRESH token, which lives seven days and is
 * only ever seen by the refresh endpoint. Doing one without the other leaves a
 * customer who can mint a new access token from a week-old cookie.
 *
 * TOUCHES EXACTLY ONE CONTACT. A company record's other portal accounts are
 * unaffected — they are separate rows with separate epochs, which is what makes
 * FR-060a true without any code here to enforce it.
 */
export async function withdraw(
  accountId: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const account = await loadAccount(accountId);

  await sequelize.transaction(async (transaction) => {
    account.status = 'withdrawn';
    account.session_epoch += 1;
    await account.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PORTAL_ACCESS_WITHDRAWN,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'portal_account',
        targetId: account.id,
        targetLabel: account.contact.value_raw,
        ...context,
      },
      transaction,
    );
  });
}

/**
 * Gives it back.
 *
 * The password is untouched: this restores the account the customer already had,
 * so somebody whose access was withdrawn in error signs in with what they know.
 * Where the password is the reason for the withdrawal, `sendResetFor` is the
 * other action on the same screen.
 */
export async function restore(
  accountId: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const account = await loadAccount(accountId);

  await sequelize.transaction(async (transaction) => {
    account.status = 'active';
    account.failed_login_attempts = 0;
    account.locked_until = null;
    await account.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PORTAL_ACCESS_RESTORED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'portal_account',
        targetId: account.id,
        targetLabel: account.contact.value_raw,
        ...context,
      },
      transaction,
    );
  });
}

/**
 * Releases a lockout (FR-057).
 *
 * Distinct from `restore` because the two situations are distinct: a lockout is
 * something the system did after failed attempts and clears itself, while a
 * withdrawal is something a person decided and does not. Merging them would mean
 * "unlock" silently reversing somebody's deliberate revocation.
 *
 * Refuses on a withdrawn account for that reason, and says so — this is one of
 * the few places a specific message helps rather than discloses, because the
 * caller is a staff member looking at a screen that already tells them the
 * status.
 */
export async function unlock(
  accountId: number,
  actor: Actor,
  context: AuditContext = {},
): Promise<void> {
  const account = await loadAccount(accountId);

  if (account.status === 'withdrawn') {
    throw forbidden([
      { field: 'accountId', message: 'This account has been withdrawn. Restore it instead.' },
    ]);
  }

  await sequelize.transaction(async (transaction) => {
    account.failed_login_attempts = 0;
    account.locked_until = null;
    await account.save({ transaction });

    await auditService.record(
      {
        action: auditService.AUDIT_ACTIONS.PORTAL_ACCOUNT_UNLOCKED,
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetType: 'portal_account',
        targetId: account.id,
        targetLabel: account.contact.value_raw,
        ...context,
      },
      transaction,
    );
  });
}
