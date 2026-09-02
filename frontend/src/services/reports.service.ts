import { request, requestFile, type DownloadedFile } from './http';

/**
 * The reporting endpoints (Phase 10).
 *
 * Every response body is a figure envelope carrying its own provenance — see
 * contracts/figure-contract.md. Nothing here returns a bare number, which is
 * why `FigureEnvelope` is the shape the whole surface is typed against.
 */
export interface FigureEnvelope<T = unknown> {
  value: T;
  count: number;
  total: number;
  excluded: Array<{ reason: string; count: number }>;
  suppressed: boolean;
  period: { from: string; to: string; timeZone: string };
  filters: Record<string, string | number | null>;
  computedAt: string;
  reflectsCurrentState: boolean;
}

export interface ReportQuery {
  from: string;
  to: string;
  category?: string | null;
  channel?: string | null;
  priority?: string | null;
  agentId?: number | null;
}

function toQuery(query: ReportQuery): string {
  const params = new URLSearchParams({ from: query.from, to: query.to });

  for (const key of ['category', 'channel', 'priority', 'agentId'] as const) {
    const value = query[key];
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  }

  return params.toString();
}

export interface VolumeReport {
  received: FigureEnvelope<number>;
  openAtEnd: FigureEnvelope<number>;
  byStatus: FigureEnvelope<Array<{ status: string; count: number }>>;
  byCategory: FigureEnvelope<Array<{ category: string; count: number }>>;
  byChannel: FigureEnvelope<Array<{ channel: string; count: number }>>;
  overTime: FigureEnvelope<Array<{ bucket: string; count: number }>>;
}

export function volume(query: ReportQuery): Promise<VolumeReport> {
  return request<VolumeReport>(`/reports/volume?${toQuery(query)}`);
}

export interface DashboardResponse {
  figures: Record<string, FigureEnvelope>;
  /**
   * The viewer's own arrangement, already filtered by their authority (FR-042).
   *
   * It travels WITH the figures rather than in a second request, so a layout
   * can never be resolved against a different period from the figures it lays
   * out — the class of disagreement FR-002 exists to prevent.
   */
  layout: string[];
  computedAt: string;
}

/**
 * ONE REQUEST FOR THE WHOLE DASHBOARD, not one per tile.
 *
 * FR-002 requires the figures to agree, and twelve independent requests resolve
 * twelve period boundaries — producing a dashboard whose total does not match
 * its own breakdown, by a day's worth of tickets, for no visible reason.
 */
export function dashboard(query: ReportQuery): Promise<DashboardResponse> {
  return request<DashboardResponse>(`/reports/dashboard?${toQuery(query)}`);
}

export interface ArrangementResponse {
  layout: string[];
  /**
   * The figures this viewer may choose from — the catalog already filtered by
   * authority, so a picker cannot offer a tile the dashboard would then omit.
   */
  available: string[];
}

export function arrangement(): Promise<ArrangementResponse> {
  return request<ArrangementResponse>('/reports/dashboard/arrangement');
}

export function saveArrangement(layout: string[]): Promise<{ layout: string[] }> {
  return request<{ layout: string[] }>('/reports/dashboard/arrangement', {
    method: 'PUT',
    body: JSON.stringify({ layout }),
  });
}

/** The two server-produced formats. PDF is the browser's print pipeline. */
export type ExportFormat = 'csv' | 'xlsx';

/**
 * Requests an export file (FR-046).
 *
 * A POST, because the server records that the data left (FR-051) — and a GET
 * that records something is a GET a link prefetcher can record for you.
 */
export function exportReport(
  report: string,
  format: ExportFormat,
  query: ReportQuery,
): Promise<DownloadedFile> {
  return requestFile(`/reports/${report}/export?${toQuery(query)}`, {
    method: 'POST',
    body: JSON.stringify({ format }),
  });
}

/**
 * Notes that a PDF print was started. BEST EFFORT, NOT A CONTROL.
 *
 * The print itself is `window.print()`. This cannot prevent one, and a reader
 * pressing Ctrl+P never reaches it at all — see `notifyPrint` on the server for
 * the full statement of the limit. Deliberately fire-and-forget: a failure here
 * must never stop the print the reader asked for.
 */
export function notifyPrint(report: string, query: ReportQuery): Promise<void> {
  return request<void>(`/reports/${report}/print`, {
    method: 'POST',
    body: JSON.stringify({ from: query.from, to: query.to }),
  }).catch(() => undefined);
}
