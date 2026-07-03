/**
 * Print paste-ready generic-intake CSV rows for the Calhoun voters that already
 * have a confirmed (non-Undetermined) fused lean — i.e. known FEC donors. Use
 * these to test the FEC → settle → tier-1 billing path end to end.
 *
 * Run from the repo root:
 *   node scripts/extract-known-donor.mjs
 *
 * Output is a CSV you can paste into /dashboard/intake. (These are real voter
 * records from your gitignored Calhoun file — keep the output local.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const OPERATOR = process.env.ALLOWED_USER_EMAIL || 'meplumb@gmail.com';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch {
    /* no .env.local */
  }
  return null;
}

function csvCell(v) {
  const s = String(v ?? '').trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const connectionString = loadDatabaseUrl();
  if (!connectionString) throw new Error('DATABASE_URL not found in env or .env.local');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [OPERATOR]);
    const { rows } = await client.query(
      `SELECT vr.raw_data AS r, f.lean, f.confidence
       FROM voter_lean_fusion f
       JOIN voter_records vr ON vr.id = f.voter_record_id
       JOIN voter_uploads u ON u.id = f.upload_id
       WHERE u.filename LIKE 'CAL_%' AND f.lean <> 'Undetermined'
       ORDER BY f.confidence DESC
       LIMIT 5`,
    );
    await client.query('ROLLBACK');

    if (rows.length === 0) {
      console.log('No confirmed-lean Calhoun voters found (is the CAL upload still in this DB?).');
      return;
    }

    console.log(`Found ${rows.length} known-donor record(s). Detected leans (for reference):`);
    for (const { r, lean, confidence } of rows) {
      console.log(`  - ${r.name?.full} → ${lean} ${confidence}%`);
    }
    console.log('\n--- paste this into /dashboard/intake ---\n');
    console.log('name,county,address,city,state,zip');
    for (const { r } of rows) {
      const res = r.residence ?? {};
      console.log(
        [
          csvCell(r.name?.full),
          csvCell(r.countyCode),
          csvCell(res.line1),
          csvCell(res.city),
          csvCell(res.state || 'FL'),
          csvCell(res.zip),
        ].join(','),
      );
    }
    console.log('\n(FEC matches on name + city/state/zip — address optional.)');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('EXTRACT ERROR:', e.message);
  process.exit(1);
});
