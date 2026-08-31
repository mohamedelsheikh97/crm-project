import type { TicketStatus } from '../tickets/lifecycle.js';
import type { TicketPriority } from '../tickets/taxonomy.js';
import type { Channel } from '../models/message.model.js';
import { AsyncLocalStorage } from 'node:async_hooks';

import type { TriggerKey } from './catalog.js';

/**
 * WHAT A SERVICE HANDS THE RULE ENGINE (Phase 6, research.md D10).
 *
 * A DECLARATION of shapes, holding no logic. Services emit these; the engine
 * consumes them; neither knows anything else about the other.
 *
 * EMISSION IS AN EXPLICIT SERVICE CALL, NEVER A SEQUELIZE MODEL HOOK. Hooks
 * were the obvious shortcut and are wrong three ways:
 *
 *   1. They live in models, which Principle III reserves for schema.
 *   2. They fire INSIDE the transaction, so a rule could act on a state that
 *      then rolls back — the exact lie `notification-hub.ts` was written to
 *      prevent, and no query can fix it afterwards.
 *   3. They cannot see the actor, which attribution (FR-086) needs.
 *
 * Every emission therefore registers an `afterCommit` callback. The ordering
 * rule is the one this codebase has followed since Phase 4: EVERYTHING RUNS
 * AFTER ITS TRANSACTION COMMITS.
 *
 * `actorUserId` is NULL when the system caused the event — an inbound message,
 * a sweep, or another rule. It is carried for attribution, never for
 * permission: nothing checks a permission at the moment a rule fires.
 */

interface BaseEvent {
  trigger: TriggerKey;
  ticketId: number;
  /** Null = the system. Never used as a permission subject. */
  actorUserId: number | null;
}

export interface TicketCreatedEvent extends BaseEvent {
  trigger: 'ticket.created';
}

export interface StatusChangedEvent extends BaseEvent {
  trigger: 'ticket.status_changed';
  from: TicketStatus;
  to: TicketStatus;
}

export interface PriorityChangedEvent extends BaseEvent {
  trigger: 'ticket.priority_changed';
  from: TicketPriority;
  to: TicketPriority;
}

export interface AssignedEvent extends BaseEvent {
  trigger: 'ticket.assigned';
  assigneeUserId: number;
}

export interface UnassignedEvent extends BaseEvent {
  trigger: 'ticket.unassigned';
}

export interface MessageReceivedEvent extends BaseEvent {
  trigger: 'message.received';
  messageId: number;
  channel: Channel;
}

export interface SlaAtRiskEvent extends BaseEvent {
  trigger: 'sla.at_risk';
  target: 'response' | 'resolution';
}

export interface SlaBreachedEvent extends BaseEvent {
  trigger: 'sla.breached';
  target: 'response' | 'resolution';
}

export type AutomationEvent =
  | TicketCreatedEvent
  | StatusChangedEvent
  | PriorityChangedEvent
  | AssignedEvent
  | UnassignedEvent
  | MessageReceivedEvent
  | SlaAtRiskEvent
  | SlaBreachedEvent;

/**
 * Carried down a cascade, created once per ORIGINATING event.
 *
 * `seen` is per originating event rather than global or per rule: FR-064
 * forbids a rule re-running on the same ticket within one event's processing,
 * and a global set would wrongly suppress the same rule legitimately firing for
 * a different event minutes later.
 */
export interface ExecutionContext {
  /** 0 for the originating event. Bounded by AUTOMATION_MAX_DEPTH (FR-062). */
  depth: number;
  /** `"ruleId:ticketId"` pairs already run in this cascade (FR-063, FR-064). */
  seen: Set<string>;
  /** For the run record, so a cascade is traceable to what started it. */
  originTrigger: TriggerKey;
}

export function newContext(originTrigger: TriggerKey): ExecutionContext {
  return { depth: 0, seen: new Set<string>(), originTrigger };
}

/**
 * THE ACTIVE CASCADE, carried across `afterCommit` boundaries.
 *
 * Without this, FR-062 and FR-063 are only half true. A rule's action calls a
 * service; that service emits its own event on ITS transaction's `afterCommit`;
 * and a fresh callback has no idea it is already three levels deep. Every hop
 * would start again at depth 0 with an empty `seen` set, so the bound would
 * never be reached and a cycle would run until something else happened to stop
 * it — which, when it was found in testing, was a no-op check in
 * `ticket.service.update` rather than anything anybody designed.
 *
 * `AsyncLocalStorage` is what makes the context follow the work rather than the
 * call stack. It is the one place in this codebase that needs it, because it is
 * the one place where causally-connected work is deliberately detached from its
 * caller.
 */
export const cascade = new AsyncLocalStorage<ExecutionContext>();

/**
 * The context an emission should run under: a child of whatever cascade is
 * already in flight, or a fresh one when this is the originating event.
 */
export function contextForEmission(trigger: TriggerKey): ExecutionContext {
  const active = cascade.getStore();

  return active ? descend(active) : newContext(trigger);
}

/** The child context an action's own emission runs under. */
export function descend(context: ExecutionContext): ExecutionContext {
  return { depth: context.depth + 1, seen: context.seen, originTrigger: context.originTrigger };
}

export function seenKey(ruleId: number, ticketId: number): string {
  return `${ruleId}:${ticketId}`;
}
