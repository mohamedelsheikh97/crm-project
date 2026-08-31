import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../config/database.js';

/**
 * The events an alert can be subscribed to (FR-079).
 *
 * A DECLARED LIST rather than a free string, so a subscription cannot name an
 * event nothing ever fires — a subscription that silently never delivers is
 * worse than no subscription at all.
 */
export const ALERT_EVENTS = {
  RESPONSE_AT_RISK: 'sla.response_at_risk',
  RESOLUTION_AT_RISK: 'sla.resolution_at_risk',
  RESPONSE_BREACHED: 'sla.response_breached',
  RESOLUTION_BREACHED: 'sla.resolution_breached',
  ASSIGNMENT_FAILED: 'assignment.failed',
} as const;

export type AlertEvent = (typeof ALERT_EVENTS)[keyof typeof ALERT_EVENTS];

export const ALL_ALERT_EVENTS = Object.values(ALERT_EVENTS) as readonly AlertEvent[];

const EVENT_SET: ReadonlySet<string> = new Set(ALL_ALERT_EVENTS);

export function isAlertEvent(value: unknown): value is AlertEvent {
  return typeof value === 'string' && EVENT_SET.has(value);
}

/**
 * Which events reach whom, over which transports (Phase 6, FR-079).
 *
 * `recipient_kind` IS A KIND, NOT A USER ID. FR-041's audience is "the
 * assignee plus the supervisory recipients"; naming individuals would break the
 * first time somebody changed job, and a subscription list that quietly stops
 * reaching anyone is the worst failure this table could have.
 *
 * `in_app` is stored but CANNOT BE TURNED OFF (FR-073). The column exists so
 * the screen can render an always-on disabled control rather than hiding a
 * transport that behaves differently from the two beside it.
 */
export class AlertSubscription extends Model<
  InferAttributes<AlertSubscription>,
  InferCreationAttributes<AlertSubscription>
> {
  declare id: CreationOptional<number>;
  declare event_key: AlertEvent;
  declare recipient_kind: 'assignee' | 'role';
  /** Required when `recipient_kind` is `role`; enforced in the service. */
  declare role_id: CreationOptional<number | null>;
  declare in_app: CreationOptional<boolean>;
  declare by_email: CreationOptional<boolean>;
  declare by_sms: CreationOptional<boolean>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AlertSubscription.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    event_key: { type: DataTypes.STRING(60), allowNull: false },
    recipient_kind: { type: DataTypes.STRING(20), allowNull: false },
    role_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    in_app: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    by_email: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    by_sms: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    sequelize,
    modelName: 'AlertSubscription',
    tableName: 'alert_subscriptions',
  },
);

export default AlertSubscription;
