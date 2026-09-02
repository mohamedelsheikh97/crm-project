import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';
import type { WebhookEventType } from './webhook-subscription.model.js';

/**
 * The payload shape, and it carries IDENTIFIERS ONLY (FR-028).
 *
 * No ticket subject or body, no customer name, no message text, no reporting
 * figure. Typed narrowly so adding record content is a type error rather than a
 * judgement call — `backend/tests/webhooks/payload-content.test.ts` also
 * searches generated payloads for distinctive fixture strings, because a type
 * cannot stop somebody widening it.
 */
export interface IntegrationEventPayload {
  readonly event_id: string;
  readonly event_type: WebhookEventType;
  readonly occurred_at: string;
  readonly api_version: string;
  readonly subject: {
    readonly type: 'ticket' | 'customer';
    readonly id: number;
    readonly url: string;
  };
}

/**
 * The transactional outbox (Phase 11, research D7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A ROW IS WRITTEN INSIDE THE TRANSACTION THAT CAUSED IT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The two failure modes are asymmetric and both matter. Written before commit
 * and rolled back, a webhook fires for something that did not happen — the
 * receiver creates a record for a ticket that does not exist and no later event
 * corrects it. Written after commit in a separate step, a crash in between loses
 * it and nobody is ever told. Inside the transaction, the event exists exactly
 * when the change does; everything after is delivery, which may fail and retry.
 *
 * `occurred_at` IS MILLISECOND PRECISION. FR-032 tells receivers to order by it
 * because delivery order is not guaranteed, and two events for one ticket inside
 * a second are ordinary — so second precision would make that instruction
 * unfollowable in exactly the case where ordering matters most.
 *
 * `payload` IS STORED, NOT RECOMPUTED AT DELIVERY. A retry twelve hours later
 * must deliver what happened, not what is true now.
 */
export class IntegrationEvent extends Model<
  InferAttributes<IntegrationEvent>,
  InferCreationAttributes<IntegrationEvent>
> {
  declare id: CreationOptional<number>;
  /**
   * The stable identifier a receiver deduplicates on (FR-031). Generated once
   * and never regenerated: a retry and an administrator's re-send both carry the
   * original, which is what lets a receiver tell a repeat from a new event.
   */
  declare event_key: string;
  declare event_type: WebhookEventType;
  declare subject_type: 'ticket' | 'customer';
  declare subject_id: number;
  declare occurred_at: Date;
  declare payload: IntegrationEventPayload;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

IntegrationEvent.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    event_key: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
    event_type: { type: DataTypes.STRING(60), allowNull: false },
    subject_type: { type: DataTypes.STRING(30), allowNull: false },
    subject_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    // DATETIME(3) in the migration. Sequelize's DATE maps to it once the column
    // exists with that precision, and the model must not narrow it back.
    occurred_at: { type: 'DATETIME(3)', allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: 'IntegrationEvent',
    tableName: 'integration_events',
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);
