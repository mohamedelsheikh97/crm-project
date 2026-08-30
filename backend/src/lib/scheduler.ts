import { sequelize } from '../config/database.js';
import { env } from '../config/env.js';
import { Task } from '../models/index.js';
import { NOTIFICATION_TYPES } from '../models/notification.model.js';
import { logger } from '../middleware/request-logger.js';
import * as notificationService from '../services/notification.service.js';
import { ticketsDueSoon } from '../services/ticket-due.service.js';
import { Op } from 'sequelize';

/**
 * The two things this system does on its own initiative (research D4).
 *
 * No job queue and no cron dependency — a `setInterval` is the whole mechanism.
 * What makes that safe is that BOTH SWEEPS ARE WRITTEN SO THAT MISSING A TICK
 * IS HARMLESS. Neither depends on having been running at any particular moment.
 *
 * STARTED FROM server.ts, NEVER app.ts. Tests import `app`, and timers started
 * there would leak into every test run. `server.ts` is the only module that
 * owns process lifetime.
 *
 * KNOWN LIMIT (plan.md Complexity Tracking): one instance. Two processes would
 * double-fire, though never lose — each notification is written in the same
 * transaction as the marker that stops it being written again, so a race
 * duplicates at worst. Multi-process operation needs a lock before it is safe.
 */

const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

/**
 * Task reminders (FR-044, FR-063).
 *
 * THE MISSING LOWER BOUND IS THE DESIGN. A reminder whose time passed while the
 * process was down is still matched on the next tick after restart, because the
 * only thing that stops it matching is `reminded_at` being set. FR-063 holds by
 * construction — there is no catch-up code path that could be forgotten, and no
 * "since last run" bookkeeping to get wrong.
 */
async function sweepTaskReminders(now: Date): Promise<number> {
  const due = await Task.findAll({
    where: {
      remind_at: { [Op.ne]: null, [Op.lte]: now },
      reminded_at: null,
      completed_at: null,
    },
    limit: 500,
  });

  for (const task of due) {
    // One transaction per task: the notification and the marker that stops it
    // being sent again commit together, or neither does. Batching them would
    // mean one bad row silently suppressing the rest.
    await sequelize.transaction(async (transaction) => {
      await notificationService.create(
        {
          userId: task.owner_user_id,
          type: NOTIFICATION_TYPES.TASK_REMINDER,
          // Null: nobody caused this. The user asked their past self to be
          // reminded, which is not an actor in the audit sense.
          actorUserId: null,
          taskId: task.id,
        },
        transaction,
      );

      task.reminded_at = now;
      await task.save({ transaction });
    });
  }

  return due.length;
}

/**
 * Approaching due dates (FR-045).
 *
 * `due_warning_sent_for` stores the due date value already warned about, so
 * "fire once per due date, do not re-fire on a re-save, re-arm on a genuine
 * reschedule" is a comparison rather than a state machine. The query lives in
 * ticket-due.service.ts; this only turns its results into notifications.
 */
async function sweepDueWarnings(now: Date): Promise<number> {
  const tickets = await ticketsDueSoon(now, env.DUE_WARNING_LEAD_MINUTES);

  for (const ticket of tickets) {
    if (ticket.assignee_user_id === null) continue;

    await sequelize.transaction(async (transaction) => {
      await notificationService.create(
        {
          userId: ticket.assignee_user_id as number,
          type: NOTIFICATION_TYPES.TICKET_DUE_SOON,
          actorUserId: null,
          ticketId: ticket.id,
        },
        transaction,
      );

      // Marks THIS date as warned. A later edit to a different date clears it
      // again (ticket-due.service.ts), arming a new warning.
      ticket.due_warning_sent_for = ticket.due_at;
      await ticket.save({ transaction });
    });
  }

  return tickets.length;
}

export interface SweepResult {
  reminders: number;
  dueWarnings: number;
}

/**
 * Exported and called directly by tests with a controlled clock, so no test
 * ever waits on a timer. The interval below is a thin wrapper around this.
 */
export async function runScheduledSweeps(now: Date = new Date()): Promise<SweepResult> {
  const [reminders, dueWarnings] = [await sweepTaskReminders(now), await sweepDueWarnings(now)];

  return { reminders, dueWarnings };
}

export function startScheduler(): void {
  if (timer) return;

  timer = setInterval(() => {
    void runScheduledSweeps().catch((error: unknown) => {
      // A failed sweep must never take the process down. The next tick retries
      // from the same query, and because neither sweep depends on having run,
      // a skipped one costs delay rather than a lost notification.
      logger.error(
        { err: error },
        'Scheduled sweep failed; the next tick will retry the same work.',
      );
    });
  }, TICK_MS);

  // Do not hold the event loop open. A process with nothing else to do should
  // be able to exit rather than being kept alive by a heartbeat.
  timer.unref();

  logger.info(
    `Scheduler started: every ${TICK_MS / 1000}s, warning ${env.DUE_WARNING_LEAD_MINUTES} minutes before a due date.`,
  );
}

export function stopScheduler(): void {
  if (!timer) return;

  clearInterval(timer);
  timer = null;
}
