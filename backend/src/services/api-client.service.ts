import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Op } from 'sequelize';

import { isPermissionKey, type PermissionKey } from '../auth/permissions.js';
import { env } from '../config/env.js';
import { sequelize } from '../config/database.js';
import { ApiClient } from '../models/api-client.model.js';
import { ApiClientPermission } from '../models/api-client-permission.model.js';
import { ApiClientSecret } from '../models/api-client-secret.model.js';

/**
 * Machine credentials (Phase 11, FR-014 - FR-023, research D3, D4, D5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SHA-256, NOT BCRYPT, AND THE REASON IS THE SECRET'S ENTROPY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This will look wrong to a reviewer who has internalised "never SHA a
 * credential", so the argument is here rather than in a commit message.
 *
 * That rule is about PASSWORDS: low-entropy secrets a human chose, where a slow
 * KDF is what makes an offline dictionary attack impractical. A 32-byte random
 * secret has no dictionary. There is nothing to slow down — and bcrypt at this
 * project's password cost factor (12) would add roughly 100ms of CPU to EVERY
 * API REQUEST, turning a deliberate anti-brute-force cost into a self-inflicted
 * throughput ceiling on the one surface designed for volume.
 *
 * This project already made the same call once: Phase 8's portal invitation
 * tokens are high-entropy random values stored as SHA-256, for the same reason
 * (`services/portal-invitation.service.ts`). Consistency here is not laziness;
 * it is the same argument applied to the same shape of secret.
 *
 * THE SECRET IS NEVER STORED. `secret_hash` holds its SHA-256; the value itself
 * exists once, in the response that creates it.
 */

/** `crmc_` — recognisable in a log or a leaked config without being useful. */
const CLIENT_ID_PREFIX = 'crmc_';
const CLIENT_ID_BYTES = 12;
const SECRET_BYTES = 32;

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak — so
 * the lengths are checked first and a mismatch answers false rather than
 * throwing. Both digests are SHA-256 hex here, so a mismatch means malformed
 * input rather than a wrong secret.
 */
function hashesMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export interface IssuedCredential {
  readonly client: ApiClient;
  /**
   * The full bearer value, `<client_id>.<secret>`. SHOWN ONCE.
   *
   * Returned from the service rather than assembled by the controller so there
   * is exactly one place the secret exists in plaintext, and it is the same
   * place that hashes it.
   */
  readonly bearer: string;
}

export interface IssueOptions {
  readonly name: string;
  readonly permissions: readonly string[];
  readonly createdByUserId: number;
  /**
   * What the granting administrator holds.
   *
   * FR-020: nobody grants a credential more authority than they have. Passed in
   * rather than read here so the check happens against the SAME permission set
   * the caller was authorised by, and so this service does not reach into
   * authorization.
   */
  readonly grantableBy: ReadonlySet<PermissionKey>;
}

export class UnknownPermissionError extends Error {
  constructor(readonly keys: string[]) {
    super(`not permission keys: ${keys.join(', ')}`);
    this.name = 'UnknownPermissionError';
  }
}

export class PermissionNotHeldError extends Error {
  constructor(readonly keys: string[]) {
    super(`cannot grant permissions you do not hold: ${keys.join(', ')}`);
    this.name = 'PermissionNotHeldError';
  }
}

/**
 * Issues a credential.
 *
 * FR-020 IS CHECKED HERE, AT GRANT TIME, and not per request. Checking per
 * request would mean a client's authority silently changing when the
 * administrator who created it changed roles — surprising, and hard to explain
 * to the integrator whose integration broke at 3am. Checked at grant time, the
 * grant is a decision with a date and an author in the audit log.
 *
 * The corresponding rule for FR-023: revoking a PERSON does not revoke the
 * client, because the client's authority is its own.
 */
export async function issue(options: IssueOptions): Promise<IssuedCredential> {
  const unknown = options.permissions.filter((key) => !isPermissionKey(key));

  if (unknown.length > 0) throw new UnknownPermissionError(unknown);

  const keys = options.permissions as readonly PermissionKey[];
  const notHeld = keys.filter((key) => !options.grantableBy.has(key));

  if (notHeld.length > 0) throw new PermissionNotHeldError([...notHeld]);

  const clientId = CLIENT_ID_PREFIX + randomBytes(CLIENT_ID_BYTES).toString('base64url');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');

  const client = await sequelize.transaction(async (transaction) => {
    const created = await ApiClient.create(
      {
        client_id: clientId,
        name: options.name,
        created_by_user_id: options.createdByUserId,
      } as never,
      { transaction },
    );

    await ApiClientSecret.create(
      { api_client_id: created.id, secret_hash: hashSecret(secret) } as never,
      { transaction },
    );

    if (keys.length > 0) {
      await ApiClientPermission.bulkCreate(
        keys.map((key) => ({ api_client_id: created.id, permission_key: key })) as never,
        { transaction },
      );
    }

    return created;
  });

  return { client, bearer: `${clientId}.${secret}` };
}

export interface ClientContext {
  readonly id: number;
  readonly clientId: string;
  readonly name: string;
  readonly permissions: ReadonlySet<PermissionKey>;
}

/**
 * Verifies a presented bearer value and returns what the credential may reach.
 *
 * `null` for EVERY failure — absent, malformed, unknown client, wrong secret,
 * expired secret, revoked client. The caller answers one 401 for all of them, so
 * a refusal cannot be used to learn whether a client identifier exists. Same
 * discipline as `authenticate`, whose comment records the equivalent reasoning
 * for a deactivated user.
 *
 * THE LOOKUP IS BY INDEXED IDENTIFIER, not by scanning hashes. That is why the
 * identifier travels alongside the secret: at request volume a scan is not an
 * option, and it also lets an administrator recognise a leaked credential from
 * its visible half.
 */
export async function verify(bearer: unknown): Promise<ClientContext | null> {
  if (typeof bearer !== 'string') return null;

  const separator = bearer.indexOf('.');

  if (separator <= 0 || separator === bearer.length - 1) return null;

  const clientId = bearer.slice(0, separator);
  const secret = bearer.slice(separator + 1);

  const client = await ApiClient.findOne({ where: { client_id: clientId } });

  // Revoked is indistinguishable from unknown, outwardly.
  if (!client || !client.is_active) return null;

  const presented = hashSecret(secret);

  const secrets = await ApiClientSecret.findAll({
    where: {
      api_client_id: client.id,
      // NULL means current; a rotated-out secret stays valid until its expiry,
      // which is what makes FR-018's zero-failure rotation possible.
      [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: new Date() } }],
    },
  });

  const matched = secrets.some((row) => hashesMatch(row.secret_hash, presented));

  if (!matched) return null;

  const granted = await ApiClientPermission.findAll({ where: { api_client_id: client.id } });

  /**
   * `last_used_at` is written on a read path, deliberately.
   *
   * One indexed-key update per authenticated request, and it is what makes
   * FR-022 answerable — "which of these forty credentials is still in use?" is
   * the question that precedes every credential cleanup. `silent` so it does not
   * bump `updated_at`, which would make the row look edited.
   */
  await client.update({ last_used_at: new Date() }, { silent: true });

  return {
    id: client.id,
    clientId: client.client_id,
    name: client.name,
    permissions: new Set(
      granted
        .map((row) => row.permission_key)
        .filter((key): key is PermissionKey => isPermissionKey(key)),
    ),
  };
}

export class UnknownClientError extends Error {
  constructor(readonly id: number) {
    super(`no api client ${id}`);
    this.name = 'UnknownClientError';
  }
}

export interface RotatedCredential {
  readonly client: ApiClient;
  /** The new bearer value. SHOWN ONCE. */
  readonly bearer: string;
  /** How long the outgoing secret keeps working. Told to the administrator. */
  readonly overlapHours: number;
}

/**
 * Rotates a credential's secret, keeping the outgoing one valid for an overlap
 * (Phase 11, FR-018, SC-009).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OVERLAP IS THE WHOLE POINT. ROTATION MUST NOT BE AN OUTAGE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * An integrator cannot atomically redeploy in step with us, so for a window both
 * secrets authenticate. SC-009 requires ZERO failed requests for an integration
 * that updates its secret at any point during that window.
 *
 * Without it, rotating means a gap — and a credential nobody can rotate without
 * an outage is a credential nobody rotates, which is how a leaked secret stays
 * live for years. The overlap is what makes the safe action the easy one.
 *
 * A NEW ROW rather than an updated one: `api_client_secrets` holds many per
 * client, each with its own expiry, so a third overlapping rotation is a data
 * question rather than a schema change.
 */
export async function rotate(id: number): Promise<RotatedCredential> {
  const client = await ApiClient.findByPk(id);

  if (!client) throw new UnknownClientError(id);

  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const overlapHours = env.CREDENTIAL_ROTATION_OVERLAP_HOURS;
  const expiresAt = new Date(Date.now() + overlapHours * 3_600_000);

  await sequelize.transaction(async (transaction) => {
    /**
     * The outgoing secret is given an expiry rather than deleted.
     *
     * Deleting it would make rotation instantaneous and therefore an outage.
     * Only rows that are still current (`expires_at IS NULL`) are touched, so
     * rotating twice in quick succession does not extend an already-expiring
     * secret's life.
     */
    await ApiClientSecret.update(
      { expires_at: expiresAt },
      { where: { api_client_id: id, expires_at: null }, transaction },
    );

    await ApiClientSecret.create({ api_client_id: id, secret_hash: hashSecret(secret) } as never, {
      transaction,
    });
  });

  return { client, bearer: `${client.client_id}.${secret}`, overlapHours };
}

/**
 * Revokes a credential, with effect on the NEXT REQUEST (FR-019, SC-010).
 *
 * Setting `is_active` false is enough because `verify` reads the row on every
 * request — there is no cached authority and no token with a lifetime of its
 * own. That immediacy is the property that ruled out service-account JWTs for
 * this phase, and the constitution amendment records the argument.
 *
 * The secrets are LEFT IN PLACE rather than deleted. A revoked credential's
 * history is worth keeping: "which secret was in use when this happened?" is a
 * question an incident asks, and deleting the rows answers it with nothing.
 */
export async function revoke(id: number): Promise<ApiClient> {
  const client = await ApiClient.findByPk(id);

  if (!client) throw new UnknownClientError(id);

  await client.update({ is_active: false });

  return client;
}

/** Whether a verified credential holds a permission. Read from the row, never a claim. */
export function holds(context: ClientContext, permission: PermissionKey): boolean {
  return context.permissions.has(permission);
}
