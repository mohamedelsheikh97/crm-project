import { http } from './http';

/**
 * SLA policies and the business calendar (Phase 6).
 *
 * DURATIONS CROSS THE WIRE AS INTEGER WORKING MINUTES, never as formatted
 * strings. A server that formats has already chosen the reader's language, and
 * the same row may be read by an Arabic user and an English one — the rule the
 * notification store has followed since Phase 4. Formatting is the interface's
 * job (see `useDuration`).
 */

export type SlaTargetState = 'met' | 'on_track' | 'at_risk' | 'breached';

export interface SlaTargetView {
  targetAt: string | null;
  state: SlaTargetState;
  /** WORKING minutes. Null once the target is met or breached. */
  remainingMinutes: number | null;
  satisfiedAt: string | null;
}

/** Null on a ticket that matched no policy — never an object of nulls. */
export interface SlaView {
  policyId: number | null;
  policyName: string | null;
  response: SlaTargetView;
  resolution: SlaTargetView;
  isPaused: boolean;
  dueSource: 'policy' | 'manual';
}

export interface SlaPolicy {
  id: number;
  name: string;
  nameAr: string | null;
  priority: string | null;
  category: string | null;
  responseMinutes: number;
  resolutionMinutes: number;
  isActive: boolean;
  specificity: number;
  /** i18n key describing what it matches — never a rendered sentence. */
  matchesLabelKey: string;
  openTicketCount: number;
  version: number;
}

export interface CalendarException {
  id: number;
  date: string;
  label: string | null;
}

export interface BusinessCalendar {
  id: number;
  name: string;
  timeZone: string;
  /** Weekday numbers, Sunday = 0. A bitmask in storage; an array on the wire. */
  workingDays: number[];
  dayStartMinute: number;
  dayEndMinute: number;
  exceptions: CalendarException[];
  version: number;
}

/**
 * THE LIST ORDER IS THE PRECEDENCE ORDER (FR-013).
 *
 * The server returns policies ordered as they are matched, so the screen
 * explains precedence by demonstrating it. Do not re-sort this client-side —
 * doing so would make the interface describe a rule the matcher does not follow.
 */
export async function listPolicies(): Promise<SlaPolicy[]> {
  const response = await http.get<{ items: SlaPolicy[] }>('/admin/sla/policies');
  return response.items;
}

export interface PolicyInput {
  name: string;
  nameAr?: string | null;
  priority: string | null;
  category: string | null;
  responseMinutes: number;
  resolutionMinutes: number;
}

export function createPolicy(input: PolicyInput): Promise<SlaPolicy> {
  return http.post<SlaPolicy>('/admin/sla/policies', input);
}

export function updatePolicy(
  id: number,
  input: PolicyInput & { version: number },
): Promise<SlaPolicy> {
  return http.patch<SlaPolicy>(`/admin/sla/policies/${id}`, input);
}

export function activatePolicy(id: number): Promise<{ policy: SlaPolicy; warning: string | null }> {
  return http.post(`/admin/sla/policies/${id}/activate`);
}

/**
 * Deactivation is the only removal (FR-019): a policy tickets were measured
 * against must stay readable. There is deliberately no `deletePolicy`.
 *
 * Returns a `warning` key when the last catch-all is switched off — a notice,
 * never a refusal, because "no policy" is a valid state (FR-014).
 */
export function deactivatePolicy(
  id: number,
): Promise<{ policy: SlaPolicy; warning: string | null }> {
  return http.post(`/admin/sla/policies/${id}/deactivate`);
}

export function getCalendar(): Promise<BusinessCalendar> {
  return http.get<BusinessCalendar>('/admin/sla/calendar');
}

export function updateCalendar(input: {
  timeZone: string;
  workingDays: number[];
  dayStartMinute: number;
  dayEndMinute: number;
  version: number;
}): Promise<BusinessCalendar & { affectedOpenTickets: number }> {
  return http.patch('/admin/sla/calendar', input);
}

export function addCalendarException(input: {
  date: string;
  label: string | null;
}): Promise<BusinessCalendar> {
  return http.post('/admin/sla/calendar/exceptions', input);
}

export function removeCalendarException(id: number): Promise<BusinessCalendar> {
  return http.delete(`/admin/sla/calendar/exceptions/${id}`);
}

// --- Alert subscriptions ---------------------------------------------------

export interface AlertSubscriptionRow {
  recipientKind: 'assignee' | 'role';
  roleId: number | null;
  roleKey: string | null;
  /** Always true and NOT adjustable (FR-073) — rendered disabled, never hidden. */
  inApp: boolean;
  byEmail: boolean;
  bySms: boolean;
  /** How many members have no alert phone, so the screen can say so up front. */
  unreachableForSms: number;
}

export interface AlertEventSubscriptions {
  eventKey: string;
  subscriptions: AlertSubscriptionRow[];
}

export async function listAlertSubscriptions(): Promise<AlertEventSubscriptions[]> {
  const response = await http.get<{ events: AlertEventSubscriptions[] }>(
    '/admin/alerts/subscriptions',
  );
  return response.events;
}

export function replaceAlertSubscriptions(
  events: AlertEventSubscriptions[],
): Promise<{ events: AlertEventSubscriptions[] }> {
  return http.put('/admin/alerts/subscriptions', { events });
}
