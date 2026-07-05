/**
 * Match a whole upload against the local FEC index (fast Tier 1) — the
 * county-scale path (the dashboard button caps at 5,000 voters to stay inside
 * serverless limits; this script has no cap).
 *
 * Usage:
 *   npx tsx scripts/run-fec-index.ts --upload-id UUID
 *   npx tsx scripts/run-fec-index.ts --county ALA
 *
 * Commits every chunk (500 voters), prints progress as it goes, and is safe to
 * re-run: settled/accepted voters are skipped by the claim predicate, and
 * evidence events upsert idempotently.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { getActiveFecIndivSnapshot, runFecIndexChunk } from '@/lib/fec/run-index-upload';
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

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
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

    const totals = { processed: 0, with_hits: 0, confirmed_identity: 0, leans: 0 };
    let afterRowIndex = -1;

    // One transaction per chunk — a crash loses at most one chunk; re-run resumes.
    for (;;) {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
      const chunk = await runFecIndexChunk(client, {
        uploadId: resolvedUploadId!,
        userId: userEmail,
        snapshot,
        afterRowIndex,
        limit: 500,
      });
      await client.query('COMMIT');

      if (chunk.processed === 0) break;
      totals.processed += chunk.processed;
      totals.with_hits += chunk.with_hits;
      totals.confirmed_identity += chunk.confirmed_identity;
      totals.leans += chunk.leans;
      afterRowIndex = chunk.last_row_index ?? afterRowIndex;

      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = Math.round(totals.processed / Math.max(1, elapsed));
      console.log(
        `${totals.processed.toLocaleString()} voters · ${totals.with_hits} with rows · ` +
          `${totals.confirmed_identity} identity-confirmed · ${totals.leans} leans · ${rate}/s`,
      );
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
