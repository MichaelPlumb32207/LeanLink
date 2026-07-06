/**
 * Match a whole upload against the local FEC index (fast Tier 1) — the
 * county-scale path (the dashboard button caps at 5,000 voters to stay inside
 * serverless limits; this script has no cap).
 *
 * Usage:
 *   npx tsx scripts/run-fec-index.ts --upload-id UUID
 *   npx tsx scripts/run-fec-index.ts --county ALA
 *   npx tsx scripts/run-fec-index.ts --upload-id UUID --start-after 15000 --concurrency 8
 *
 * Commits in batches, prints progress as it goes, and is safe to re-run:
 * settled/accepted voters are skipped by the claim predicate, and evidence
 * events upsert idempotently. --start-after skips rows with row_index ≤ N
 * (continue a partial pass without re-touching its rows).
 *
 * --concurrency N (default 4, max 16) processes N voters in parallel on
 * separate connections. The per-voter cost is Neon round-trip latency, not
 * Postgres work, so overlapping the waits scales nearly linearly. Workers
 * commit every ~10 voters; distinct voters never contend (events, fusion,
 * settlement are all voter-scoped).
 *
 * Progress is written to arm_runs (migration 014) every chunk, so the
 * dashboard's current-inning panel shows this run live. Ctrl-C marks the run
 * 'cancelled' (a kill -9 leaves it to the 10-minute stale reaper).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import {
  claimFecIndexRows,
  getActiveFecIndivSnapshot,
  processFecIndexVoter,
  type FecIndexVoterRow,
} from '@/lib/fec/run-index-upload';
import {
  countEligibleVoters,
  finishArmRun,
  heartbeatArmRun,
  startArmRun,
} from '@/lib/evidence/arm-runs';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import { keepAwakeWhileRunning } from '@/lib/cli/keep-awake';

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnvLocal();
  keepAwakeWhileRunning('the FEC index match');
  const uploadId = arg('--upload-id');
  const county = arg('--county');
  const userEmail = process.env.ALLOWED_USER_EMAIL;
  const url = process.env.DATABASE_URL;
  if (!userEmail || !url) {
    console.error('ALLOWED_USER_EMAIL and DATABASE_URL must be set (load .env.local)');
    process.exit(1);
  }

  const concurrency = Math.min(16, Math.max(1, Number(arg('--concurrency') ?? 4)));
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: true },
    max: concurrency + 2,
  });
  const client = await pool.connect();
  const startedAt = Date.now();
  try {
    let resolvedUploadId = uploadId;
    if (!resolvedUploadId) {
      if (!county) {
        console.error('Usage: npx tsx scripts/run-fec-index.ts --upload-id UUID | --county ALA');
        process.exit(1);
      }
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
      const res = await client.query<{ id: string; filename: string; row_count: number }>(
        `SELECT id, filename, row_count FROM voter_uploads
         WHERE user_id = $1 AND filename ILIKE $2
         ORDER BY created_at DESC LIMIT 1`,
        [userEmail, `${county}_%`],
      );
      await client.query('COMMIT');
      const row = res.rows[0];
      if (!row) {
        console.error(`No upload found for county ${county}`);
        process.exit(1);
      }
      resolvedUploadId = row.id;
      console.log(`Upload: ${row.filename} (${row.row_count} rows) → ${resolvedUploadId}`);
    }

    // Snapshot check in its own transaction.
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
    const snapshot = await getActiveFecIndivSnapshot(client);
    await client.query('COMMIT');
    if (!snapshot) {
      console.error(
        'No READY fec_indiv snapshot. Load one first: npx tsx scripts/import-fec-indiv.ts …',
      );
      process.exit(1);
    }
    console.log(`FEC index snapshot: ${snapshot.label}`);

    const startAfter = Number(arg('--start-after') ?? -1);

    // Register the run so the dashboard's current-inning panel can watch it.
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
    const patterns = await loadLeanPatterns(client, userEmail);
    console.log(
      `Lean patterns: ${patterns.meta.rowCount} rows (${patterns.meta.source}` +
        (patterns.meta.invalidCount ? `, ${patterns.meta.invalidCount} invalid skipped` : '') +
        ')',
    );
    const totalCount = await countEligibleVoters(client, resolvedUploadId!, userEmail);
    const runId = await startArmRun(client, {
      uploadId: resolvedUploadId!,
      userId: userEmail,
      arm: 'fec',
      runner: 'fec_index_cli',
      totalCount,
      meta: { snapshot: snapshot.label, chunk_size: 500, start_after: startAfter },
    });
    await client.query('COMMIT');
    if (!runId) {
      console.error(
        'An active fec run already exists for this upload (arm_runs). ' +
          'If it is dead, it will be reaped after 10 minutes without a heartbeat — retry then.',
      );
      process.exit(1);
    }
    console.log(`Concurrency: ${concurrency} worker(s)`);

    // Ctrl-C / kill → mark the run cancelled so the dashboard shows intent,
    // not a stall. (kill -9 can't be caught; the 10-min reaper covers that.)
    let cancelling = false;
    const cancel = () => {
      if (cancelling) return;
      cancelling = true;
      console.log('\nCancelling — marking arm_runs row cancelled…');
      void (async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
          await finishArmRun(c, runId, 'cancelled');
          await c.query('COMMIT');
        } catch {
          /* reaper covers us */
        } finally {
          c.release();
          process.exit(130);
        }
      })();
    };
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);

    const totals = { processed: 0, with_hits: 0, confirmed_identity: 0, leans: 0 };
    let afterRowIndex = startAfter;

    try {
      for (;;) {
        // Claim the next chunk (read-only) on the main connection.
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
        const queue = await claimFecIndexRows(client, {
          uploadId: resolvedUploadId!,
          userId: userEmail,
          afterRowIndex,
          limit: 500,
        });
        await client.query('COMMIT');
        if (queue.length === 0) break;
        const lastRowIndex = queue[queue.length - 1].row_index;

        // Fan the chunk out across workers; each commits every ~10 voters.
        // queue.splice is safe — JS is single-threaded between awaits.
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
          const wc = await pool.connect();
          try {
            for (;;) {
              const batch: FecIndexVoterRow[] = queue.splice(0, 10);
              if (batch.length === 0) return;
              await wc.query('BEGIN');
              await wc.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
              try {
                for (const voter of batch) {
                  const r = await processFecIndexVoter(wc, {
                    uploadId: resolvedUploadId!,
                    userId: userEmail,
                    snapshot,
                    voter,
                    patterns,
                  });
                  totals.processed += 1;
                  if (r.with_hit) totals.with_hits += 1;
                  if (r.confirmed) totals.confirmed_identity += 1;
                  if (r.lean) totals.leans += 1;
                }
                await wc.query('COMMIT');
              } catch (e) {
                await wc.query('ROLLBACK').catch(() => {});
                throw e;
              }
            }
          } finally {
            wc.release();
          }
        });
        await Promise.all(workers);

        afterRowIndex = lastRowIndex;

        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
        await heartbeatArmRun(client, runId, {
          processed: totals.processed,
          hits: totals.with_hits,
          confirmed: totals.confirmed_identity,
          leanSignals: totals.leans,
        });
        await client.query('COMMIT');

        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = totals.processed / Math.max(1, elapsed);
        console.log(
          `${totals.processed.toLocaleString()} voters · ${totals.with_hits} with rows · ` +
            `${totals.confirmed_identity} identity-confirmed · ${totals.leans} leans · ` +
            `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}/s`,
        );
      }

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
      await finishArmRun(client, runId, 'completed');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      // Best-effort terminal status in a fresh transaction so the UI shows
      // failed instead of a silent stall.
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
        await finishArmRun(
          client,
          runId,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
        await client.query('COMMIT');
      } catch {
        /* the reaper covers us if even this fails */
      }
      throw error;
    }

    console.log(
      JSON.stringify(
        { ...totals, snapshot: snapshot.label, seconds: Math.round((Date.now() - startedAt) / 1000) },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
