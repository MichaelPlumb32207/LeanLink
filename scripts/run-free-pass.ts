/**
 * Tier 2 free pass for a whole upload (FL contrib + Sunbiz indexes) — the
 * county-scale path (the dashboard buttons cap at 5,000 eligible voters).
 *
 * Usage:
 *   npx tsx scripts/run-free-pass.ts --upload-id UUID --steps fl-contrib --concurrency 8
 *   npx tsx scripts/run-free-pass.ts --county DUV --steps all
 *   npx tsx scripts/run-free-pass.ts --upload-id UUID --start-after 15000
 *
 * --steps fl-contrib (household + person-name FL contributions — dashboard
 * step ④), sunbiz (officer match + entity layer 2 — step ⑤), or all (default).
 * Chunk-committed (workers commit every ~5 voters), resumable via
 * --start-after, progress in arm_runs (live in the dashboard box score).
 * Ctrl-C marks the run cancelled; kill -9 is reaped after 10 minutes.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import {
  claimFreePassRows,
  loadFreePassContext,
  runFreePassVoterWithContext,
  type FreePassContext,
  type FreePassVoterRow,
} from '@/lib/free-pass/run-upload';
import {
  FREE_PASS_ALL,
  FREE_PASS_FL_CONTRIB,
  FREE_PASS_SUNBIZ_ENTITY,
  type FreePassSteps,
} from '@/lib/free-pass/steps';
import {
  countEligibleVoters,
  finishArmRun,
  heartbeatArmRun,
  startArmRun,
} from '@/lib/evidence/arm-runs';
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

function resolveSteps(value: string | undefined): { steps: FreePassSteps; arm: string; label: string } {
  if (value === 'fl-contrib') {
    return { steps: FREE_PASS_FL_CONTRIB, arm: 'fl_contrib', label: 'fl-contrib' };
  }
  if (value === 'sunbiz') {
    return { steps: FREE_PASS_SUNBIZ_ENTITY, arm: 'sunbiz', label: 'sunbiz' };
  }
  return { steps: FREE_PASS_ALL, arm: 'fl_contrib', label: 'all' };
}

async function main() {
  loadEnvLocal();
  keepAwakeWhileRunning('the free pass');
  const uploadId = arg('--upload-id');
  const county = arg('--county');
  const { steps, arm, label } = resolveSteps(arg('--steps'));
  const startAfter = Number(arg('--start-after') ?? -1);
  const concurrency = Math.min(16, Math.max(1, Number(arg('--concurrency') ?? 4)));
  const userEmail = process.env.ALLOWED_USER_EMAIL;
  const url = process.env.DATABASE_URL;
  if (!userEmail || !url) {
    console.error('ALLOWED_USER_EMAIL and DATABASE_URL must be set (load .env.local)');
    process.exit(1);
  }

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
        console.error(
          'Usage: npx tsx scripts/run-free-pass.ts --upload-id UUID | --county DUV [--steps fl-contrib|sunbiz|all]',
        );
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

    // Load shared context + register the run.
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
    const context: FreePassContext = await loadFreePassContext(
      client,
      resolvedUploadId!,
      userEmail,
    );
    if (context.missing_indexes.length > 0) {
      await client.query('ROLLBACK');
      console.error(
        `Missing reference indexes: ${context.missing_indexes.join(', ')} — load them first (SETUP).`,
      );
      process.exit(1);
    }
    const totalCount = await countEligibleVoters(client, resolvedUploadId!, userEmail);
    const runId = await startArmRun(client, {
      uploadId: resolvedUploadId!,
      userId: userEmail,
      arm,
      runner: 'free_pass_cli',
      totalCount,
      meta: { steps: label, chunk_size: 500, start_after: startAfter, concurrency },
    });
    await client.query('COMMIT');
    if (!runId) {
      console.error(
        `An active ${arm} run already exists for this upload (arm_runs). ` +
          'If it is dead, it will be reaped after 10 minutes without a heartbeat — retry then.',
      );
      process.exit(1);
    }
    console.log(
      `Steps: ${label} (arm ${arm}) · eligible ${totalCount.toLocaleString()} · concurrency ${concurrency}`,
    );

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

    const totals = { processed: 0, events_total: 0, hits: 0, settled_before: -1 };
    let settledNow = 0;
    let afterRowIndex = startAfter;
    // Time-based heartbeat: at slow per-voter rates a 500-voter chunk can take
    // >5 min, which trips the UI's stalled warning. Workers refresh the
    // heartbeat inside their batch transaction (RLS config still set) when due.
    const heartbeat = { last: Date.now() };
    const HEARTBEAT_MS = 45_000;

    try {
      for (;;) {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
        const queue = await claimFreePassRows(client, {
          uploadId: resolvedUploadId!,
          userId: userEmail,
          afterRowIndex,
          limit: 500,
        });
        await client.query('COMMIT');
        if (queue.length === 0) break;
        const lastRowIndex = queue[queue.length - 1].row_index;

        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
          const wc = await pool.connect();
          try {
            for (;;) {
              const batch: FreePassVoterRow[] = queue.splice(0, 5);
              if (batch.length === 0) return;
              await wc.query('BEGIN');
              await wc.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
              try {
                for (const voter of batch) {
                  const r = await runFreePassVoterWithContext(wc, {
                    uploadId: resolvedUploadId!,
                    userId: userEmail,
                    context,
                    steps,
                    voter,
                  });
                  totals.processed += 1;
                  totals.events_total += r.events_written;
                  if (r.fl_contrib_layer1 + r.fl_contrib_layer2 + r.sunbiz_hits > 0) {
                    totals.hits += 1;
                  }
                }
                if (Date.now() - heartbeat.last > HEARTBEAT_MS) {
                  heartbeat.last = Date.now();
                  await heartbeatArmRun(wc, runId, {
                    processed: totals.processed,
                    hits: totals.hits,
                    confirmed: totals.hits,
                    leanSignals: settledNow,
                  });
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

        // Heartbeat + settled tally (settles happen inside per-voter fusion;
        // count them at this arm's tier so the strip's "leans" is meaningful).
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
        const settledRes = await client.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM voter_lean_fusion
           WHERE upload_id = $1 AND user_id = $2 AND settled_arm = $3`,
          [resolvedUploadId!, userEmail, arm],
        );
        settledNow = Number(settledRes.rows[0]?.n ?? 0);
        if (totals.settled_before === -1) totals.settled_before = settledNow;
        await heartbeatArmRun(client, runId, {
          processed: totals.processed,
          hits: totals.hits,
          confirmed: totals.hits,
          leanSignals: settledNow,
        });
        await client.query('COMMIT');

        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = totals.processed / Math.max(1, elapsed);
        const etaMin = (totalCount - totals.processed) / Math.max(rate, 0.01) / 60;
        console.log(
          `${totals.processed.toLocaleString()} voters · ${totals.hits} with hits · ` +
            `${totals.events_total} events · ${settledNow} settled@${arm} · ` +
            `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}/s · ETA ${etaMin.toFixed(0)} min`,
        );
      }

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
      await finishArmRun(client, runId, 'completed');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
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
        /* the reaper covers us */
      }
      throw error;
    }

    console.log(
      JSON.stringify(
        {
          steps: label,
          processed: totals.processed,
          with_hits: totals.hits,
          events_total: totals.events_total,
          settled_at_arm: settledNow,
          settled_gained: totals.settled_before >= 0 ? settledNow - totals.settled_before : null,
          seconds: Math.round((Date.now() - startedAt) / 1000),
        },
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
