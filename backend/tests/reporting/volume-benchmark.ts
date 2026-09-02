/**
 * A realistic-volume measurement for the reporting queries (Phase 10, T111,
 * research D1, SC-018).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOT A TEST. A MEASUREMENT, RUN DELIBERATELY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It is excluded from the suite on purpose: it inserts hundreds of thousands of
 * rows and takes minutes, and a slow machine would make it flaky as an
 * assertion while telling you nothing you could act on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT REFUSES TO RUN AGAINST A DATABASE THAT IS NOT A THROWAWAY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 300,000 synthetic tickets in a working database is not a benchmark, it is an
 * incident — and the damage is quiet, because every screen still works and
 * every number is now wrong. So it insists on a schema whose name ends
 * `_test` or `_bench` unless `BENCHMARK_I_MEAN_IT=yes` is set, and it says
 * which database it is about to write to before it writes anything.
 *
 * Run it with a throwaway schema:
 *
 *   cd backend && DB_NAME=crm_support_bench npx tsx tests/reporting/volume-benchmark.ts
 *
 * (Create the schema and migrate it first; this script seeds rows, it does not
 * build the tables.)
 *
 * WHY IT EXISTS. Research D1 claimed the reporting queries would serve at
 * realistic volume against seven new indexes, rather than needing a read
 * replica or a warehouse. Until measured, that is a claim. If it turns out to
 * be wrong, THAT is the finding that would justify a replica — and the
 * constitution amendment that comes with it, because the technology standards
 * table does not currently permit one.
 *
 * The one index the schema was actually missing before this phase was
 * `tickets(created_at)` — every report in the phase filters on it, and nothing
 * before now had needed to.
 *
 * WHAT IT DOES NOT MEASURE. Concurrency. SC-018 asks about the maximum
 * supported number of dashboards refreshing on an interval, which needs
 * parallel clients rather than a loop; this measures one query at a time, which
 * is the necessary first number rather than the whole answer.
 */
import { performance } from 'node:perf_hooks';

import { sequelize } from '../../src/config/database.js';
import { parse } from '../../src/reporting/filters.js';
import { resolve } from '../../src/reporting/period.js';
import * as agentService from '../../src/services/report-agent.service.js';
import * as csatService from '../../src/services/report-csat.service.js';
import * as slaService from '../../src/services/report-sla.service.js';
import * as volumeService from '../../src/services/report-volume.service.js';

/** Two years of tickets at roughly 400 a day — a busy but ordinary desk. */
const TICKETS = 300_000;
const BATCH = 5_000;

const CATEGORIES = ['general', 'billing', 'technical', 'complaint'];
const STATUSES = ['new', 'open', 'pending', 'escalated', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CHANNELS = ['email', 'portal', 'chat', 'form'];

async function seed(): Promise<void> {
  process.stdout.write(`seeding ${TICKETS.toLocaleString()} tickets`);

  const [customer] = (await sequelize.query(
    `INSERT INTO customers (display_name, type, status, created_at, updated_at)
     VALUES ('Benchmark', 'company', 'active', NOW(), NOW())`,
  )) as unknown as [{ insertId: number }, unknown];

  const customerId = (customer as unknown as { insertId?: number }).insertId ?? 1;

  const [agents] = (await sequelize.query(`SELECT id FROM users ORDER BY id LIMIT 12`)) as [
    Array<{ id: number }>,
    unknown,
  ];

  if (agents.length === 0) throw new Error('no users to attribute tickets to; run the seeders');

  const start = new Date(Date.UTC(2025, 0, 1)).getTime();
  const end = new Date(Date.UTC(2026, 11, 31)).getTime();

  for (let inserted = 0; inserted < TICKETS; inserted += BATCH) {
    const rows: string[] = [];

    for (let index = 0; index < BATCH && inserted + index < TICKETS; index += 1) {
      const at = new Date(start + Math.random() * (end - start));
      const stamp = at.toISOString().slice(0, 19).replace('T', ' ');

      // One in twenty unassigned, so the exclusion path is exercised rather
      // than measured against a population that never triggers it.
      const assignee = Math.random() < 0.05 ? 'NULL' : String(agents[index % agents.length]!.id);

      rows.push(
        `(${customerId}, 'Benchmark ticket', 'body', ` +
          `'${CATEGORIES[index % CATEGORIES.length]}', ` +
          `'${PRIORITIES[index % PRIORITIES.length]}', ` +
          `'${STATUSES[index % STATUSES.length]}', ` +
          `'${CHANNELS[index % CHANNELS.length]}', ` +
          `${assignee}, '${stamp}', '${stamp}')`,
      );
    }

    await sequelize.query(
      `INSERT INTO tickets
         (customer_id, subject, description, category, priority, status, source,
          assignee_user_id, created_at, updated_at)
       VALUES ${rows.join(',')}`,
    );

    process.stdout.write('.');
  }

  process.stdout.write(' done\n');
}

async function time(label: string, run: () => Promise<unknown>): Promise<number> {
  // Warmed once, then measured three times and reported as the median. A single
  // cold run measures the buffer pool, not the query.
  await run();

  const samples: number[] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }

  samples.sort((left, right) => left - right);
  const median = samples[1]!;

  console.log(`  ${label.padEnd(28)} ${median.toFixed(0).padStart(6)} ms`);

  return median;
}

async function main(): Promise<void> {
  const { env } = await import('../../src/config/env.js');

  /**
   * The guard, before anything is written.
   *
   * Named schemas rather than a prompt: this is meant to be runnable in CI or
   * from a script, and a prompt there is a hang. `BENCHMARK_I_MEAN_IT` is the
   * deliberate override, spelled so nobody sets it by accident.
   */
  const disposable = /_(test|bench)$/.test(env.DB_NAME);

  if (!disposable && process.env.BENCHMARK_I_MEAN_IT !== 'yes') {
    console.error(
      `refusing to seed ${TICKETS.toLocaleString()} synthetic tickets into "${env.DB_NAME}".\n` +
        'Use a schema whose name ends _test or _bench, or set BENCHMARK_I_MEAN_IT=yes.',
    );

    await sequelize.close();
    process.exitCode = 1;
    return;
  }

  console.log(`target database: ${env.DB_NAME}`);

  const [[existing]] = (await sequelize.query(`SELECT COUNT(*) AS n FROM tickets`)) as [
    Array<{ n: number }>,
    unknown,
  ];

  if (Number(existing!.n) < TICKETS) await seed();
  else console.log(`${Number(existing!.n).toLocaleString()} tickets already present; not seeding`);

  const period = await resolve('2026-02-01', '2026-02-28');
  const filters = parse({});
  const wide = await resolve('2025-06-01', '2026-05-31');

  console.log('\nreport timings (median of 3, after one warm-up):\n');

  const results = {
    volumeMonth: await time('volume, one month', () => volumeService.report(period, filters)),
    volumeYear: await time('volume, twelve months', () => volumeService.report(wide, filters)),
    sla: await time('sla, one month', () => slaService.report(period, filters)),
    csat: await time('csat, one month', () => csatService.report(period, filters)),
    agents: await time('agents, one month', () => agentService.report(period, filters)),
  };

  const worst = Math.max(...Object.values(results));

  console.log('');
  console.log(`worst: ${worst.toFixed(0)} ms`);

  /**
   * The threshold, and why this one.
   *
   * The dashboard endpoint is what an interval refresh calls, so it is the
   * number that matters — and a figure a reader waits more than about two
   * seconds for is one they stop refreshing. Above that, D1's claim needs
   * revisiting: the honest answers would be a materialised summary table or a
   * read replica, and the second is a constitution amendment.
   */
  console.log(
    worst < 2000
      ? 'WITHIN BUDGET — D1 holds at this volume, single-client.'
      : 'OVER BUDGET — D1 needs revisiting; see the note in this file.',
  );

  await sequelize.close();
}

await main();
