import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sequelize } from '../../src/config/database.js';
import { closeTestDatabase, setupTestDatabase } from '../helpers/database.js';

/**
 * `ai_invocations` HOLDS METADATA AND NOTHING ELSE (Phase 9, Clarifications Q3,
 * FR-065, SC-024b).
 *
 * The column list is FROZEN here. Adding one is a deliberate act that fails a
 * test, rather than a migration that passes review because a prompt column
 * looks like a debugging convenience.
 *
 * The failure this guards against is specific and plausible: someone
 * investigating a bad summary adds `prompt TEXT` "temporarily", and the system
 * quietly acquires a second copy of every ticket thread — in plaintext, with its
 * own lifetime, its own access rules, and its own deletion obligation, outside
 * every protection Phases 2, 5 and 8 built around the first copy. It would not
 * be noticed, and it would not be removed.
 *
 * If you are here because this test failed: the answer is almost never to widen
 * the list. Regenerate the summary from the thread, which has not gone anywhere.
 */
const FROZEN_COLUMNS = [
  'id',
  'feature',
  'subject_type',
  'subject_id',
  'requested_by',
  'portal_account_id',
  'location',
  'outcome',
  'input_tokens',
  'output_tokens',
  'duration_ms',
  'error_code',
  'created_at',
  'updated_at',
].sort();

/** Substrings that must never appear in a column name on this table. */
const FORBIDDEN_FRAGMENTS = [
  'prompt',
  'completion',
  'response',
  'body',
  'content',
  'text',
  'message',
  'input_text',
  'output_text',
];

describe('the AI invocation record stores no content', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  }, 90_000);

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('has exactly the frozen column set', async () => {
    const description = await sequelize.getQueryInterface().describeTable('ai_invocations');

    expect(Object.keys(description).sort()).toEqual(FROZEN_COLUMNS);
  });

  it('has no column whose name suggests it holds content', async () => {
    const description = await sequelize.getQueryInterface().describeTable('ai_invocations');

    const suspicious = Object.keys(description).filter((column) =>
      FORBIDDEN_FRAGMENTS.some((fragment) => column.toLowerCase().includes(fragment)),
    );

    expect(
      suspicious,
      'ai_invocations must never hold a prompt or a completion (Clarifications Q3). ' +
        'A summary can be regenerated from the thread; a second copy of the thread cannot be un-created.',
    ).toEqual([]);
  });

  it('has no TEXT or BLOB column — the shapes content arrives in', async () => {
    const description = await sequelize.getQueryInterface().describeTable('ai_invocations');

    const wide = Object.entries(description)
      .filter(([, meta]) => /TEXT|BLOB|JSON/i.test(String(meta.type)))
      .map(([column]) => column);

    expect(wide).toEqual([]);
  });
});
