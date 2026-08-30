import { http } from './http';

/**
 * Personal follow-up commitments.
 *
 * There is no owner field on any payload here, and there must not be: tasks are
 * personal (Clarifications Q3), and the server takes the owner from the
 * session. Sending one is rejected rather than ignored.
 */

export interface Task {
  id: number;
  title: string;
  dueAt: string | null;
  remindAt: string | null;
  /** Server-computed against the server clock, like a ticket's (FR-020). */
  isOverdue: boolean;
  completedAt: string | null;
  ticket: { id: number; reference: string; subject: string } | null;
  customer: { id: number; displayName: string } | null;
  createdAt: string;
}

export interface TaskPage {
  items: Task[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TaskInput {
  title: string;
  dueAt?: string | null;
  remindAt?: string | null;
  ticketId?: number;
  customerId?: number;
}

export function fetchTasks(
  query: { status?: 'open' | 'completed' | 'all'; ticketId?: number; page?: number } = {},
): Promise<TaskPage> {
  const params = new URLSearchParams();

  if (query.status) params.set('status', query.status);
  if (query.ticketId !== undefined) params.set('ticketId', String(query.ticketId));
  if (query.page) params.set('page', String(query.page));

  const search = params.toString();

  return http.get<TaskPage>(`/tasks${search === '' ? '' : `?${search}`}`);
}

export function createTask(input: TaskInput): Promise<Task> {
  return http.post<Task>('/tasks', input);
}

export function updateTask(id: number, input: Partial<TaskInput>): Promise<Task> {
  return http.patch<Task>(`/tasks/${id}`, input);
}

export function completeTask(id: number): Promise<Task> {
  return http.post<Task>(`/tasks/${id}/complete`);
}

export function reopenTask(id: number): Promise<Task> {
  return http.post<Task>(`/tasks/${id}/reopen`);
}
