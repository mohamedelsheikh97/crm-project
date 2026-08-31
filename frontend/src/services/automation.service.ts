import { http } from './http';

/**
 * Assignment and automation (Phase 6).
 *
 * THE CATALOG COMES FROM THE SERVER, and the builder screen renders only what
 * it returns. That is what makes it impossible for the interface to offer a
 * combination the validator would refuse — one declaration, three consumers,
 * no second copy (research D9).
 */

// --- Assignment ------------------------------------------------------------

export type AssignmentStrategy = 'off' | 'round_robin' | 'least_loaded' | 'competency';

export interface AssignmentSettings {
  strategy: AssignmentStrategy;
  maxOpenPerAgent: number | null;
  /** Shown while choosing, so "nobody is eligible" is not discovered at 02:00. */
  eligibleAgentCount: number;
  version: number;
}

export interface CompetencyRow {
  userId: number;
  fullName: string;
  roleKey: string | null;
  categories: string[];
}

export function getAssignmentSettings(): Promise<AssignmentSettings> {
  return http.get<AssignmentSettings>('/admin/assignment');
}

export function updateAssignmentSettings(input: {
  strategy: AssignmentStrategy;
  maxOpenPerAgent: number | null;
  version: number;
}): Promise<AssignmentSettings> {
  return http.patch('/admin/assignment', input);
}

export function listCompetencies(): Promise<{ categories: string[]; users: CompetencyRow[] }> {
  return http.get('/admin/assignment/competencies');
}

/** Replaces the whole set: the resource IS a set, and a diff API for four
 *  values is more failure surface than it is worth. */
export function replaceCompetencies(userId: number, categories: string[]): Promise<CompetencyRow> {
  return http.put(`/admin/assignment/competencies/${userId}`, { categories });
}

// --- Automation ------------------------------------------------------------

export interface CatalogTrigger {
  key: string;
  nameKey: string;
}

export interface CatalogConditionField {
  key: string;
  nameKey: string;
  operators: string[];
  values: string[];
  onlyForTriggers?: string[];
}

export interface CatalogActionParam {
  key: string;
  kind: string;
  values?: string[];
  required: boolean;
}

export interface CatalogAction {
  key: string;
  nameKey: string;
  params: CatalogActionParam[];
}

export interface AutomationCatalog {
  triggers: CatalogTrigger[];
  conditionFields: CatalogConditionField[];
  actions: CatalogAction[];
}

export interface RuleCondition {
  field: string;
  operator: string;
  value: unknown;
}

export interface RuleAction {
  action: string;
  params: Record<string, unknown>;
}

export interface AutomationRule {
  id: number;
  name: string;
  triggerKey: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  isEnabled: boolean;
  runOrder: number;
  createdBy: { id: number; fullName: string } | null;
  version: number;
}

export function getCatalog(): Promise<AutomationCatalog> {
  return http.get<AutomationCatalog>('/admin/automation/catalog');
}

export async function listRules(): Promise<AutomationRule[]> {
  const response = await http.get<{ items: AutomationRule[] }>('/admin/automation/rules');
  return response.items;
}

export interface RuleInput {
  name: string;
  triggerKey: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

/** Always created disabled (FR-061): saving and running are separate acts. */
export function createRule(input: RuleInput): Promise<AutomationRule> {
  return http.post<AutomationRule>('/admin/automation/rules', input);
}

export function updateRule(
  id: number,
  input: RuleInput & { version: number },
): Promise<AutomationRule> {
  return http.patch<AutomationRule>(`/admin/automation/rules/${id}`, input);
}

export function enableRule(id: number): Promise<AutomationRule> {
  return http.post<AutomationRule>(`/admin/automation/rules/${id}/enable`);
}

export function disableRule(id: number): Promise<AutomationRule> {
  return http.post<AutomationRule>(`/admin/automation/rules/${id}/disable`);
}

export async function reorderRules(ruleIds: number[]): Promise<AutomationRule[]> {
  const response = await http.put<{ items: AutomationRule[] }>('/admin/automation/rules/order', {
    ruleIds,
  });
  return response.items;
}

export function deleteRule(id: number): Promise<void> {
  return http.delete(`/admin/automation/rules/${id}`);
}

export interface DryRunResult {
  sampleSize: number;
  matched: Array<{ ticket: { id: number; subject: string }; wouldApply: RuleAction[] }>;
  unmatchedCount: number;
}

/** Writes nothing. The condition evaluator behind it is pure (FR-066). */
export function dryRunRule(id: number, overrides: Partial<RuleInput> = {}): Promise<DryRunResult> {
  return http.post<DryRunResult>(`/admin/automation/rules/${id}/dry-run`, overrides);
}

export interface AutomationRun {
  id: number;
  ruleId: number | null;
  /** Present even when `ruleId` is null — the record outlives the rule. */
  ruleName: string;
  triggerKey: string;
  ticket: { id: number; reference: string } | null;
  outcome: 'acted' | 'no_match' | 'suppressed' | 'failed';
  depth: number;
  actionsApplied: unknown;
  /** `{ key, params }` — rendered from its key, never displayed raw. */
  detail: { key: string; params?: Record<string, unknown> } | null;
  createdAt: string;
}

export function listRuns(filters: Record<string, string> = {}): Promise<{
  items: AutomationRun[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const query = new URLSearchParams(filters).toString();
  return http.get(`/admin/automation/runs${query ? `?${query}` : ''}`);
}
