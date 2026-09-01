import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * The channels this system can exchange messages on.
 *
 * Declared here rather than as a bare string union so the adapters, the
 * services, the intake ledger, and the tests all read one list — the same move
 * `NOTIFICATION_TYPES` and `tickets/lifecycle.ts` made before it.
 */
export const CHANNELS = {
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  SMS: 'sms',
  CHAT: 'chat',
  FORM: 'form',
  /**
   * The customer portal (Phase 8, research.md D6).
   *
   * A channel with no transport: a portal message is delivered by being read,
   * because both ends of the conversation are inside this application.
   */
  PORTAL: 'portal',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

export const ALL_CHANNELS = Object.values(CHANNELS) as readonly Channel[];

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (ALL_CHANNELS as readonly string[]).includes(value);
}

/**
 * A form is inbound-only: it has no reply path of its own (FR-003).
 *
 * THE PORTAL IS REPLYABLE, and Phase 8 research D6 exists because that is not
 * the obvious answer. Treating it like `form` looked cheaper and does not work:
 * `message.service.conversationFor` derives the reply channel and recipient from
 * the most recent inbound message FILTERED TO THIS LIST, and returns null
 * otherwise. A portal-submitted ticket would therefore have no reply path at
 * all — the hole Phase 5 left for form submissions, inherited into the one
 * phase whose Definition of done requires a customer to be answered where they
 * wrote.
 *
 * Do not remove `PORTAL` from this list to "tidy up" a channel with no
 * transport. The adapter's `send` performing no network call is the point, not
 * a symptom.
 */
export const REPLYABLE_CHANNELS: readonly Channel[] = [
  CHANNELS.EMAIL,
  CHANNELS.WHATSAPP,
  CHANNELS.SMS,
  CHANNELS.CHAT,
  CHANNELS.PORTAL,
];

export type MessageDirection = 'inbound' | 'outbound';

/**
 * Delivery state, reported honestly.
 *
 * `pending` and `sent` are NOT `delivered`. FR-047 forbids showing a message as
 * delivered before the provider says so, because an agent who believes an
 * answer arrived stops chasing it.
 */
export const DELIVERY_STATES = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
} as const;

export type DeliveryState = (typeof DELIVERY_STATES)[keyof typeof DELIVERY_STATES];

/**
 * One communication with a customer, inbound or outbound.
 *
 * THERE IS NO `is_internal` FLAG, AND NONE IS TO BE ADDED. Phase 4's internal
 * notes are `TicketNote` and stay there. One table with a boolean deciding
 * whether content may leave the building is the design FR-002, FR-044 and
 * SC-006 exist to prevent: a wrong default or a missed filter becomes a
 * disclosure of something a colleague wrote in confidence. Two models make that
 * mistake unrepresentable rather than merely unlikely.
 *
 * `occurred_at` IS NOT `created_at`. The first is when the communication
 * happened according to the channel; the second is when this system recorded
 * it. They diverge whenever a poller catches up or a provider redelivers late,
 * and FR-092 orders by the former.
 *
 * NO `customer_id`. A message's customer is its ticket's customer. A second
 * copy would be a second thing the customer merge in FR-019 has to keep in
 * step.
 */
export class Message extends Model<InferAttributes<Message>, InferCreationAttributes<Message>> {
  declare id: CreationOptional<number>;
  declare ticket_id: number;
  declare channel: Channel;
  declare direction: MessageDirection;
  /** Set on outbound, null on inbound (FR-046). */
  declare author_user_id: CreationOptional<number | null>;
  /** As received. Never rewritten — what a human is shown. */
  declare sender_identity: CreationOptional<string | null>;
  /** Through lib/phone.ts. What identity resolution matched on. */
  declare sender_identity_normalised: CreationOptional<string | null>;
  declare body: string;
  /** What ARRIVED, so nothing is re-guessed on read. */
  declare body_format: CreationOptional<'text' | 'html_source'>;
  /** The provider's identifier for this message (FR-007). */
  declare provider_message_id: CreationOptional<string | null>;
  /**
   * The Message-ID this system generated for an outbound email. UNIQUE, because
   * it is what an inbound reply's In-Reply-To is matched against (research D4)
   * — two messages sharing one would thread a reply onto the wrong ticket.
   */
  declare outbound_message_id: CreationOptional<string | null>;
  declare delivery_state: CreationOptional<DeliveryState>;
  /** Why it failed. Shown to the agent who sent it (FR-048). */
  declare delivery_detail: CreationOptional<string | null>;
  declare occurred_at: Date;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

Message.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    ticket_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    channel: { type: DataTypes.STRING(20), allowNull: false },
    direction: { type: DataTypes.STRING(10), allowNull: false },
    author_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    sender_identity: { type: DataTypes.STRING(255), allowNull: true },
    sender_identity_normalised: { type: DataTypes.STRING(255), allowNull: true },
    body: { type: DataTypes.TEXT('medium'), allowNull: false },
    body_format: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'text' },
    provider_message_id: { type: DataTypes.STRING(255), allowNull: true },
    outbound_message_id: { type: DataTypes.STRING(255), allowNull: true },
    delivery_state: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
    delivery_detail: { type: DataTypes.STRING(500), allowNull: true },
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, modelName: 'Message', tableName: 'messages' },
);

export default Message;
