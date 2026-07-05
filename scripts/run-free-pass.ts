/**
 * Run Tier 0 free pass for a whole upload (FL contrib + Sunbiz indexes).
 *
 * Usage:
 *   npx tsx scripts/run-free-pass.ts --upload-id UUID
 *   npx tsx scripts/run-free-pass.ts --county CAL
 */
import { runFreePassForUpload } from '@/lib/free-pass/run-upload';
import { keepAwakeWhileRunning } from '@/lib/cli/keep-awake';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

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
  keepAwakeWhileRunning('the free pass');
  const uploadId = arg('--upload-id');
  const county = arg('--county');
  const userEmail = process.env.ALLOWED_USER_EMAIL;
  const url = process.env.DATABASE_URL;
  if (!userEmail) {
    console.error('ALLOWED_USER_EMAIL must be set (load .env.local)');
    process.exit(1);
  }
  if (!url) {
    console.error('DATABASE_URL must be set (load .env.local)');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    let resolvedUploadId = uploadId;
    if (!resolvedUploadId) {
      if (!county) {
        console.error('Usage: npx tsx scripts/run-free-pass.ts --upload-id UUID | --county CAL');
        process.exit(1);
      }
      const res = await client.query<{ id: string; filename: string; row_count: number }>(
        `SELECT id, filename, row_count FROM voter_uploads
         WHERE user_id = $1 AND filename ILIKE $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [userEmail, `${county}_%`],
      );
      const row = res.rows[0];
      if (!row) {
        console.error(`No upload found for county ${county}`);
        process.exit(1);
      }
      resolvedUploadId = row.id;
      console.log(`Upload: ${row.filename} (${row.row_count} rows) → ${resolvedUploadId}`);
    }

    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
    const result = await runFreePassForUpload(client, resolvedUploadId!, userEmail);
    await client.query('COMMIT');

    const withSunbiz = result.rows.filter((r) => r.sunbiz_hits > 0).length;
    const withL1 = result.rows.filter((r) => r.fl_contrib_layer1 > 0).length;
    const withL2 = result.rows.filter((r) => r.fl_contrib_layer2 > 0).length;

    console.log(
      JSON.stringify(
        {
          processed: result.processed,
          events_total: result.events_total,
          fl_contrib_snapshot: result.fl_contrib_snapshot,
          sunbiz_snapshots: result.sunbiz_snapshots,
          missing_indexes: result.missing_indexes,
          voters_with_sunbiz: withSunbiz,
          voters_with_fl_layer1: withL1,
          voters_with_fl_layer2: withL2,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query('ROLLBACK');
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